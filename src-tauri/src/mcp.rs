//! Tavily web search through its hosted MCP server.
//!
//! The search tools are handed to rig as ordinary `DynamicTool`s, so the chat
//! agent does not need to know they came from MCP. Only the tools in
//! [`ALLOWED`] are exposed: `tavily-map` and `tavily-crawl` can spend a lot of
//! credits and flood the chat budget, and the assistant only needs search and
//! page extraction.
//!
//! Results are untrusted web content; the chat preamble says so.

use std::sync::Arc;
use std::time::Duration;

use rig_core::message::ToolName;
use rig_core::tool::{DynamicTool, ToolExecutionError, ToolOutput};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock};
use rmcp::service::RunningService;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::{RoleClient, ServiceExt};
use serde_json::Value;

const ENDPOINT: &str = "https://mcp.tavily.com/mcp";
const ALLOWED: [&str; 2] = ["tavily_search", "tavily_extract"];
const MAX_RESULT_BYTES: usize = 6_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

type Client = RunningService<RoleClient, ()>;

/// Only these Tavily tools are offered to the model.
pub fn tool_allowed(name: &str) -> bool {
    ALLOWED.contains(&name)
}

/// Connect to Tavily and wrap its allowed tools. The connection is kept alive
/// by the returned tools; dropping them closes it.
pub async fn tools(key: &str) -> Result<Vec<DynamicTool>, String> {
    let config = StreamableHttpClientTransportConfig::with_uri(ENDPOINT)
        // The value is the bearer token without the "Bearer " prefix, so the
        // key never appears in the URL or in request logs.
        .auth_header(key);
    let client = tokio::time::timeout(
        CONNECT_TIMEOUT,
        ().serve(StreamableHttpClientTransport::from_config(config)),
    )
    .await
    .map_err(|_| "Tavily MCP did not answer in time".to_string())?
    .map_err(|e| format!("Tavily MCP handshake failed: {e}"))?;
    let client = Arc::new(client);

    let listed = client
        .peer()
        .list_tools(Default::default())
        .await
        .map_err(|e| format!("Tavily MCP list failed: {e}"))?;

    let tools = listed
        .tools
        .into_iter()
        .filter(|t| tool_allowed(&t.name))
        .filter_map(|tool| {
            let name = tool.name.to_string();
            let tool_name = ToolName::new(name.clone()).ok()?;
            let description = tool
                .description
                .map(|d| d.to_string())
                .unwrap_or_else(|| format!("Tavily {name}"));
            let schema = Value::Object((*tool.input_schema).clone());
            let client = Arc::clone(&client);
            Some(DynamicTool::new(tool_name, description, schema, move |args| {
                let client = Arc::clone(&client);
                let name = name.clone();
                Box::pin(async move { run(&client, &name, args).await })
            }))
        })
        .collect();
    Ok(tools)
}

async fn run(
    client: &Client,
    name: &str,
    args: Value,
) -> Result<ToolOutput, ToolExecutionError> {
    let arguments = match args {
        Value::Object(map) => map,
        _ => return Err(ToolExecutionError::invalid_args("arguments must be an object")),
    };
    let call = client
        .peer()
        .call_tool(CallToolRequestParams::new(name.to_string()).with_arguments(arguments));
    let result = tokio::time::timeout(CALL_TIMEOUT, call)
        .await
        .map_err(|_| ToolExecutionError::timeout("Tavily did not answer in time"))?
        .map_err(|e| ToolExecutionError::provider(format!("Tavily call failed: {e}")))?;

    let text = result_text(&result);
    // Tavily reports auth and quota failures as ordinary content with
    // `isError: false` and a JSON body, so inspect the payload too.
    if let Some(message) = failure(&result) {
        return Err(ToolExecutionError::provider(message));
    }
    if result.is_error == Some(true) {
        return Err(ToolExecutionError::provider(if text.is_empty() {
            "Tavily returned an error".to_string()
        } else {
            text
        }));
    }
    if text.is_empty() {
        return Err(ToolExecutionError::provider("Tavily returned no results"));
    }
    Ok(ToolOutput::text(text))
}

/// The text of a result, truncated.
fn result_text(result: &CallToolResult) -> String {
    let mut text = raw_text(result);
    if text.is_empty() {
        if let Some(value) = &result.structured_content {
            text = value.to_string();
        }
    }
    truncate(text)
}

fn raw_text(result: &CallToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// An HTTP-level failure hidden inside a successful MCP result.
fn failure(result: &CallToolResult) -> Option<String> {
    let value = result.structured_content.clone().or_else(|| {
        serde_json::from_str::<Value>(&raw_text(result)).ok()
    })?;
    let status = value.get("status").and_then(Value::as_u64).unwrap_or(0);
    if status < 400 {
        return None;
    }
    let message = value
        .pointer("/detail/error")
        .and_then(Value::as_str)
        .or_else(|| value.get("error").and_then(Value::as_str))
        .unwrap_or("Tavily request failed");
    Some(message.to_string())
}

fn truncate(mut text: String) -> String {
    if text.len() <= MAX_RESULT_BYTES {
        return text;
    }
    let mut end = MAX_RESULT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push_str("\n… truncated");
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_search_and_extract_are_exposed() {
        assert!(tool_allowed("tavily_search"));
        assert!(tool_allowed("tavily_extract"));
        assert!(!tool_allowed("tavily_map"));
        assert!(!tool_allowed("tavily_crawl"));
        assert!(!tool_allowed("tavily_research"));
        assert!(!tool_allowed(""));
    }

    #[test]
    fn truncates_on_a_char_boundary() {
        let short = "abc".to_string();
        assert_eq!(truncate(short.clone()), short);
        let long = "遊".repeat(MAX_RESULT_BYTES);
        let out = truncate(long);
        assert!(out.ends_with("… truncated"));
        assert!(out.len() > MAX_RESULT_BYTES);
    }

    #[test]
    fn detects_an_error_hidden_in_success_content() {
        let result: CallToolResult = serde_json::from_value(serde_json::json!({
            "content": [{"type":"text","text":"{\"error\":\"Search failed\",\"status\":401}"}],
            "isError": false,
            "structuredContent": {
                "error": "Search failed",
                "status": 401,
                "detail": {"error": "Unauthorized: missing or invalid API key."}
            }
        }))
        .unwrap();
        assert_eq!(
            failure(&result).as_deref(),
            Some("Unauthorized: missing or invalid API key.")
        );
    }

    /// Hits the real endpoint. The handshake and tool listing must work, and a
    /// rejected key must surface as a failed tool call rather than a panic.
    #[test]
    #[ignore = "network"]
    fn reaches_the_hosted_server() {
        let tools = tauri::async_runtime::block_on(tools("tvly-invalid"))
            .expect("the server should complete the MCP handshake");
        assert_eq!(
            tools.iter().map(|t| t.name().as_str().to_string()).collect::<Vec<_>>(),
            vec!["tavily_search", "tavily_extract"]
        );
        let failed = tauri::async_runtime::block_on(
            tools[0].run(serde_json::json!({"query": "test"})),
        );
        assert!(failed.is_err(), "an invalid key must not return results");
    }
}
