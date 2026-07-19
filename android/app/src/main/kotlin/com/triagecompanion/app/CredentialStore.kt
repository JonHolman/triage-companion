package com.triagecompanion.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

enum class CredentialKey(val service: String, val account: String) {
    GITHUB_TOKEN("Triage Companion-GitHub", "notifications-token"),
    SNYK_TOKEN("Triage Companion-Snyk", "token"),
    SNYK_API_BASE_URL("Triage Companion-Config", "snyk-api-base-url"),
    JIRA_BASE_URL("Triage Companion-Jira", "base-url"),
    JIRA_EMAIL("Triage Companion-Jira", "email"),
    JIRA_API_TOKEN("Triage Companion-Jira", "api-token"),
    JIRA_CLOUD_ID("Triage Companion-Jira", "cloud-id");

    val storageKey: String get() = "$service\u001F$account"
}

interface CredentialStoring {
    fun read(key: CredentialKey): String?
    fun save(value: String?, key: CredentialKey)
}

// Values are encrypted with an AES-256-GCM key that never leaves the Android
// Keystore, mirroring the iOS app's device-only Keychain storage.
class AppCredentialStore(context: Context) : CredentialStoring {
    private val preferences =
        context.applicationContext.getSharedPreferences("credentials", Context.MODE_PRIVATE)

    override fun read(key: CredentialKey): String? {
        val stored = preferences.getString(key.storageKey, null) ?: return null
        val decoded = try {
            Base64.decode(stored, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            throw TriageCompanionException("Stored credential could not be decoded.")
        }
        if (decoded.size <= GCM_IV_LENGTH) {
            throw TriageCompanionException("Stored credential could not be decoded.")
        }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(GCM_TAG_BITS, decoded, 0, GCM_IV_LENGTH),
        )
        val plaintext = try {
            cipher.doFinal(decoded, GCM_IV_LENGTH, decoded.size - GCM_IV_LENGTH)
        } catch (_: Exception) {
            throw TriageCompanionException("Stored credential could not be decrypted.")
        }

        return String(plaintext, Charsets.UTF_8)
    }

    override fun save(value: String?, key: CredentialKey) {
        if (value == null) {
            preferences.edit().remove(key.storageKey).apply()
            return
        }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        preferences.edit().putString(key.storageKey, encoded).apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) {
            return existing
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "triage-companion-credentials"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_IV_LENGTH = 12
        const val GCM_TAG_BITS = 128
    }
}
