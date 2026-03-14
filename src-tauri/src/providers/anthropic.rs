use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::{get_language_name, TranslationResult};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: Vec<SystemBlock>,
    messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
struct SystemBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<CacheControl>,
}

#[derive(Debug, Serialize)]
struct CacheControl {
    #[serde(rename = "type")]
    cache_type: String,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

/// Translate text using Claude API with prompt caching
pub async fn translate(
    client: &reqwest::Client,
    text: &str,
    source_language: &str,
    target_language: &str,
    api_key: &str,
    model: &str,
) -> Result<TranslationResult, String> {
    if api_key.is_empty() {
        return Err("Anthropic API key not configured".to_string());
    }

    let source_lang_name = get_language_name(source_language);
    let target_lang_name = get_language_name(target_language);

    // System prompt (cacheable) - contains static translation instructions
    // This gets cached for 5 minutes, reducing costs for repeated translations
    let system_prompt = format!(
        "You are a professional translator. Your task is to translate {} text to {}. \
        Follow these rules strictly:\n\
        1. Only respond with the translation, nothing else.\n\
        2. Do not add any explanations, notes, or additional text.\n\
        3. Maintain the original tone and meaning as closely as possible.\n\
        4. Preserve any formatting like line breaks or punctuation.",
        source_lang_name, target_lang_name
    );

    let request = AnthropicRequest {
        model: model.to_string(),
        max_tokens: 4096,
        system: vec![SystemBlock {
            block_type: "text".to_string(),
            text: system_prompt,
            cache_control: Some(CacheControl {
                cache_type: "ephemeral".to_string(),
            }),
        }],
        messages: vec![Message {
            role: "user".to_string(),
            content: text.to_string(),
        }],
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|_| "Invalid API key format")?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static(ANTHROPIC_VERSION),
    );
    // Enable prompt caching beta feature
    headers.insert(
        "anthropic-beta",
        HeaderValue::from_static("prompt-caching-2024-07-31"),
    );

    let response = client
        .post(ANTHROPIC_API_URL)
        .headers(headers)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Anthropic API error ({}): {}", status, error_text));
    }

    let api_response: AnthropicResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let translated_text = api_response
        .content
        .into_iter()
        .filter(|block| block.content_type == "text")
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("");

    if translated_text.is_empty() {
        return Err("No translation received from Anthropic API".to_string());
    }

    log::info!(
        "Anthropic translation complete: {} -> {} ({} chars)",
        source_language,
        target_language,
        translated_text.len()
    );

    Ok(TranslationResult {
        translated_text,
        source_language: source_language.to_string(),
        target_language: target_language.to_string(),
    })
}

/// Placeholder function - Ollama check is in ollama.rs
pub async fn check_ollama_running() -> bool {
    super::ollama::check_ollama_running().await
}
