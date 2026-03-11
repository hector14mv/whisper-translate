use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "com.whispertranslate.app";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ApiKeyType {
    Anthropic,
    OpenAI,
    Google,
}

impl ApiKeyType {
    fn account_name(&self) -> &str {
        match self {
            ApiKeyType::Anthropic => "anthropic_api_key",
            ApiKeyType::OpenAI => "openai_api_key",
            ApiKeyType::Google => "google_api_key",
        }
    }
}

/// Save an API key to the macOS Keychain
#[tauri::command(rename_all = "camelCase")]
pub fn save_api_key(key_type: String, api_key: String) -> Result<(), String> {
    let key_type = match key_type.as_str() {
        "anthropic" => ApiKeyType::Anthropic,
        "openai" => ApiKeyType::OpenAI,
        "google" => ApiKeyType::Google,
        _ => return Err("Invalid key type".to_string()),
    };

    set_generic_password(SERVICE_NAME, key_type.account_name(), api_key.as_bytes())
        .map_err(|e| format!("Failed to save API key: {}", e))?;

    log::info!("Successfully saved {:?} API key to Keychain", key_type);
    Ok(())
}

/// Retrieve an API key from the macOS Keychain
#[tauri::command(rename_all = "camelCase")]
pub fn get_api_key(key_type: String) -> Result<Option<String>, String> {
    let key_type = match key_type.as_str() {
        "anthropic" => ApiKeyType::Anthropic,
        "openai" => ApiKeyType::OpenAI,
        "google" => ApiKeyType::Google,
        _ => return Err("Invalid key type".to_string()),
    };

    match get_generic_password(SERVICE_NAME, key_type.account_name()) {
        Ok(password) => {
            let key = String::from_utf8(password.to_vec())
                .map_err(|e| format!("Invalid UTF-8 in stored key: {}", e))?;
            Ok(Some(key))
        }
        Err(e) => {
            if e.code() == -25300 {
                // errSecItemNotFound
                Ok(None)
            } else {
                Err(format!("Failed to retrieve API key: {}", e))
            }
        }
    }
}

/// Delete an API key from the macOS Keychain
#[tauri::command(rename_all = "camelCase")]
pub fn delete_api_key(key_type: String) -> Result<(), String> {
    let key_type = match key_type.as_str() {
        "anthropic" => ApiKeyType::Anthropic,
        "openai" => ApiKeyType::OpenAI,
        "google" => ApiKeyType::Google,
        _ => return Err("Invalid key type".to_string()),
    };

    match delete_generic_password(SERVICE_NAME, key_type.account_name()) {
        Ok(_) => {
            log::info!("Successfully deleted {:?} API key from Keychain", key_type);
            Ok(())
        }
        Err(e) => {
            if e.code() == -25300 {
                // errSecItemNotFound - not an error if it doesn't exist
                Ok(())
            } else {
                Err(format!("Failed to delete API key: {}", e))
            }
        }
    }
}

/// Validate an API key format (basic validation, not actual API call)
#[tauri::command(rename_all = "camelCase")]
pub fn validate_api_key(key_type: String, api_key: String) -> Result<bool, String> {
    match key_type.as_str() {
        "anthropic" => {
            // Anthropic keys start with "sk-ant-"
            Ok(api_key.starts_with("sk-ant-") && api_key.len() > 20)
        }
        "openai" => {
            // OpenAI keys start with "sk-" or "sk-proj-"
            Ok(api_key.starts_with("sk-") && api_key.len() > 20)
        }
        "google" => {
            // Google API keys start with "AIza"
            Ok(api_key.starts_with("AIza") && api_key.len() > 20)
        }
        _ => Err("Invalid key type".to_string()),
    }
}
