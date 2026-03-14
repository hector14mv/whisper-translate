use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::{build_translation_prompt, TranslationResult};

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<Content>,
    #[serde(rename = "generationConfig")]
    generation_config: GenerationConfig,
}

#[derive(Debug, Serialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Debug, Serialize)]
struct Part {
    text: String,
}

#[derive(Debug, Serialize)]
struct GenerationConfig {
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Debug, Deserialize)]
struct CandidateContent {
    parts: Vec<ResponsePart>,
}

#[derive(Debug, Deserialize)]
struct ResponsePart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiError {
    message: String,
}

/// Translate text using Google Gemini API
pub async fn translate(
    client: &reqwest::Client,
    text: &str,
    source_language: &str,
    target_language: &str,
    api_key: &str,
    model: &str,
) -> Result<TranslationResult, String> {
    if api_key.is_empty() {
        return Err("Google API key not configured".to_string());
    }

    let prompt = build_translation_prompt(text, source_language, target_language);

    let url = format!("{}/{}:generateContent?key={}", GEMINI_API_BASE, model, api_key);

    let request = GeminiRequest {
        contents: vec![Content {
            parts: vec![Part { text: prompt }],
        }],
        generation_config: GenerationConfig {
            max_output_tokens: 4096,
        },
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let response = client
        .post(&url)
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
        return Err(format!("Google API error ({}): {}", status, error_text));
    }

    let api_response: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(error) = api_response.error {
        return Err(format!("Google API error: {}", error.message));
    }

    let translated_text = api_response
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content.parts.into_iter().next())
        .and_then(|p| p.text)
        .ok_or("No translation received from Google API")?;

    if translated_text.is_empty() {
        return Err("Empty translation received from Google API".to_string());
    }

    log::info!(
        "Google translation complete: {} -> {} ({} chars)",
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
