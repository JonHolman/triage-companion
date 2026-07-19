package com.triagecompanion.app

import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

class HttpResult(val body: String, val linkHeader: String?)

class HttpClient {
    private val client = OkHttpClient()

    suspend fun data(
        url: String,
        method: String = "GET",
        headers: Map<String, String>,
        serviceName: String,
    ): HttpResult = withContext(Dispatchers.IO) {
        val builder = try {
            Request.Builder().url(url)
        } catch (_: IllegalArgumentException) {
            throw TriageCompanionException("Could not load $serviceName: request URL was invalid.")
        }
        builder.method(method, if (method == "GET") null else ByteArray(0).toRequestBody(null))
        for ((name, value) in headers) {
            builder.header(name, value)
        }

        val response = try {
            client.newCall(builder.build()).execute()
        } catch (error: IOException) {
            throw TriageCompanionException("Could not load $serviceName: ${error.message ?: error.javaClass.simpleName}")
        }
        response.use {
            val body = it.body?.string() ?: ""
            if (it.code !in 200..299) {
                throw TriageCompanionException("$serviceName API error ${it.code}: ${errorPreview(body)}")
            }

            HttpResult(body, it.header("Link"))
        }
    }

    suspend fun jsonObject(
        url: String,
        headers: Map<String, String>,
        serviceName: String,
    ): Pair<JSONObject, HttpResult> {
        val result = data(url, headers = headers, serviceName = serviceName)
        val value = try {
            JSONTokener(result.body).nextValue()
        } catch (error: JSONException) {
            throw TriageCompanionException("$serviceName response could not be decoded: ${error.message}")
        }
        if (value !is JSONObject) {
            throw TriageCompanionException("$serviceName response must be a JSON object.")
        }

        return value to result
    }

    suspend fun jsonArray(
        url: String,
        headers: Map<String, String>,
        serviceName: String,
    ): Pair<JSONArray, HttpResult> {
        val result = data(url, headers = headers, serviceName = serviceName)
        val value = try {
            JSONTokener(result.body).nextValue()
        } catch (error: JSONException) {
            throw TriageCompanionException("$serviceName response could not be decoded: ${error.message}")
        }
        if (value !is JSONArray) {
            throw TriageCompanionException("$serviceName response must be a JSON array.")
        }

        return value to result
    }

    suspend fun requestWithoutBody(
        url: String,
        method: String,
        headers: Map<String, String>,
        serviceName: String,
    ) {
        data(url, method, headers, serviceName)
    }

    private fun errorPreview(body: String): String {
        val normalized = body.trim()
        if (normalized.isEmpty()) {
            return "response body was empty."
        }

        return normalized.take(500)
    }
}

fun urlWithQuery(baseURL: String, queryItems: List<Pair<String, String>>): String {
    if (queryItems.isEmpty()) {
        return baseURL
    }

    val query = queryItems.joinToString("&") { (name, value) ->
        "${encodedQueryComponent(name)}=${encodedQueryComponent(value)}"
    }
    return "$baseURL?$query"
}

fun nextURL(linkHeader: String?): String? {
    if (linkHeader == null) {
        return null
    }

    for (entry in linkHeader.split(",")) {
        val pieces = entry.split(";").map { it.trim() }
        if (!pieces.contains("rel=\"next\"")) {
            continue
        }
        val first = pieces.firstOrNull()
        if (first == null || !first.startsWith("<") || !first.endsWith(">")) {
            throw TriageCompanionException("Pagination link header was malformed.")
        }

        return first.substring(1, first.length - 1)
    }

    return null
}

fun encodedPathComponent(value: String): String =
    URLEncoder.encode(value, "UTF-8").replace("+", "%20")

fun encodedQueryComponent(value: String): String =
    URLEncoder.encode(value, "UTF-8").replace("+", "%20")

fun queryPairs(uri: java.net.URI): List<Pair<String, String?>> {
    val raw = uri.rawQuery ?: return emptyList()
    if (raw.isEmpty()) {
        return emptyList()
    }

    return raw.split("&").map { entry ->
        val separator = entry.indexOf('=')
        if (separator < 0) {
            (percentDecoded(entry) ?: entry) to null
        } else {
            val name = entry.substring(0, separator)
            val value = entry.substring(separator + 1)
            (percentDecoded(name) ?: name) to (percentDecoded(value) ?: value)
        }
    }
}

fun sortedQueryString(uri: java.net.URI, excluding: Set<String>): String =
    queryPairs(uri)
        .filter { it.first !in excluding }
        .sortedWith(compareBy({ it.first }, { it.second ?: "" }))
        .joinToString("&") { (name, value) ->
            if (value != null) {
                "${encodedQueryComponent(name)}=${encodedQueryComponent(value)}"
            } else {
                encodedQueryComponent(name)
            }
        }

fun queryValue(uri: java.net.URI, name: String): String? =
    queryPairs(uri).firstOrNull { it.first == name }?.second

fun percentDecoded(value: String): String? {
    val bytes = java.io.ByteArrayOutputStream()
    val literal = StringBuilder()
    var index = 0
    while (index < value.length) {
        val character = value[index]
        if (character == '%') {
            if (index + 2 >= value.length) {
                return null
            }
            val decoded = value.substring(index + 1, index + 3).toIntOrNull(16) ?: return null
            bytes.write(literal.toString().toByteArray(Charsets.UTF_8))
            literal.setLength(0)
            bytes.write(decoded)
            index += 3
        } else {
            literal.append(character)
            index += 1
        }
    }
    bytes.write(literal.toString().toByteArray(Charsets.UTF_8))

    return String(bytes.toByteArray(), Charsets.UTF_8)
}
