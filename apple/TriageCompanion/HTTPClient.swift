import Foundation

struct HTTPClient {
    func data(for request: URLRequest, serviceName: String) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw TriageCompanionError.message("\(serviceName) returned a non-HTTP response.")
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                throw TriageCompanionError.message("\(serviceName) API error \(httpResponse.statusCode): \(errorPreview(from: data))")
            }

            return (data, httpResponse)
        } catch let error as TriageCompanionError {
            throw error
        } catch {
            throw TriageCompanionError.message("Could not load \(serviceName): \(error.localizedDescription)")
        }
    }

    func decoded<T: Decodable>(
        _ type: T.Type,
        from request: URLRequest,
        serviceName: String,
        decoder: JSONDecoder = JSONDecoder()
    ) async throws -> (T, HTTPURLResponse) {
        let (data, response) = try await data(for: request, serviceName: serviceName)
        do {
            return (try decoder.decode(type, from: data), response)
        } catch {
            throw TriageCompanionError.message("\(serviceName) response could not be decoded: \(error.localizedDescription)")
        }
    }

    func jsonObject(from request: URLRequest, serviceName: String) async throws -> ([String: Any], HTTPURLResponse) {
        let (data, response) = try await data(for: request, serviceName: serviceName)
        let value = try JSONSerialization.jsonObject(with: data)
        guard let object = value as? [String: Any] else {
            throw TriageCompanionError.message("\(serviceName) response must be a JSON object.")
        }

        return (object, response)
    }

    func requestWithoutBody(_ request: URLRequest, serviceName: String) async throws {
        _ = try await data(for: request, serviceName: serviceName)
    }

    private func errorPreview(from data: Data) -> String {
        let text = String(data: data, encoding: .utf8) ?? "response body was not UTF-8"
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty {
            return "response body was empty."
        }

        return String(normalized.prefix(500))
    }
}

func request(
    url: URL,
    method: String = "GET",
    headers: [String: String],
    cachePolicy: URLRequest.CachePolicy = .reloadIgnoringLocalCacheData
) -> URLRequest {
    var request = URLRequest(url: url, cachePolicy: cachePolicy)
    request.httpMethod = method
    for (key, value) in headers {
        request.setValue(value, forHTTPHeaderField: key)
    }

    return request
}

func urlWithQuery(_ baseURL: URL, queryItems: [URLQueryItem]) -> URL {
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    components.queryItems = queryItems
    return components.url!
}

func nextURL(from linkHeader: String?) throws -> URL? {
    guard let linkHeader else {
        return nil
    }

    for entry in linkHeader.split(separator: ",") {
        let pieces = entry.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        guard pieces.contains("rel=\"next\"") else {
            continue
        }
        guard let first = pieces.first, first.hasPrefix("<"), first.hasSuffix(">") else {
            throw TriageCompanionError.message("Pagination link header was malformed.")
        }

        let urlText = String(first.dropFirst().dropLast())
        guard let url = URL(string: urlText) else {
            throw TriageCompanionError.message("Pagination link header included an invalid URL.")
        }

        return url
    }

    return nil
}

func encodedPathComponent(_ value: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}
