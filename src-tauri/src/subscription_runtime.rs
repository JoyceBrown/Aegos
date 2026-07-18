use base64::{engine::general_purpose, Engine as _};
use reqwest::blocking::Client;
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};
use std::{collections::HashMap, time::Duration};

pub(crate) const AEGOS_URI_PROTOCOLS: &[&str] = &[
    "ss",
    "trojan",
    "vmess",
    "vless",
    "hysteria2",
    "hy2",
    "anytls",
    "tuic",
];

#[derive(Clone, Default, Debug)]
pub(crate) struct ProfileSourceSummary {
    pub(crate) format: String,
    pub(crate) proxies: usize,
    pub(crate) proxy_groups: usize,
    pub(crate) rules: usize,
    pub(crate) unsupported_lines: usize,
}

#[derive(Debug)]
pub(crate) struct ProfileSource {
    pub(crate) config: YamlValue,
    pub(crate) summary: ProfileSourceSummary,
}

pub(crate) fn diagnostic(stage: &str, reason: impl AsRef<str>, suggestion: &str) -> String {
    format!(
        "Subscription diagnostics [{stage}]: {}. Suggestion: {suggestion}. Open Logs or Diagnostics for details.",
        reason.as_ref()
    )
}

pub(crate) fn is_ignorable_line(line: &str) -> bool {
    let line = line.trim().trim_start_matches('\u{feff}');
    if line.is_empty() || line.starts_with('#') || line.starts_with("//") || line.starts_with(';') {
        return true;
    }
    let lower = line.to_ascii_lowercase();
    lower.starts_with("subscription-userinfo:")
        || lower.starts_with("profile-title:")
        || lower.starts_with("profile-update-interval:")
        || lower.starts_with("profile-web-page-url:")
        || lower.starts_with("support-url:")
        || lower.starts_with("upload=")
        || lower.starts_with("download=")
        || lower.starts_with("total=")
        || lower.starts_with("expire=")
}

pub(crate) fn decoded_body(text: &str) -> String {
    let raw = text.trim_start_matches('\u{feff}').trim();
    if raw.contains("://") || looks_like_clash_yaml(raw) {
        raw.to_string()
    } else {
        decode_base64_text(raw).unwrap_or_else(|| raw.to_string())
    }
}

pub(crate) fn unsupported_uri_schemes(text: &str, supported: &[&str]) -> Vec<String> {
    let body = decoded_body(text);
    let mut schemes = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_line(line))
        .filter_map(|line| line.split_once("://").map(|(scheme, _)| scheme.trim()))
        .filter(|scheme| {
            let scheme = scheme.to_ascii_lowercase();
            !scheme.is_empty() && !supported.contains(&scheme.as_str())
        })
        .map(|scheme| scheme.to_ascii_lowercase())
        .collect::<Vec<_>>();
    schemes.sort();
    schemes.dedup();
    schemes
}

pub(crate) fn looks_like_clash_yaml(text: &str) -> bool {
    text.lines().take(48).any(|line| {
        let line = line.trim_start();
        line.starts_with("proxies:")
            || line.starts_with("proxy-groups:")
            || line.starts_with("rules:")
            || line.starts_with("mixed-port:")
            || line.starts_with("port:")
            || line.starts_with("socks-port:")
    })
}

pub(crate) fn summarize_source(
    config: &YamlValue,
    format: &str,
    unsupported_lines: usize,
) -> Result<ProfileSourceSummary, String> {
    let proxies = yaml_sequence(config, "proxies")
        .map(|items| items.len())
        .unwrap_or(0);
    let proxy_groups = yaml_sequence(config, "proxy-groups")
        .map(|items| items.len())
        .unwrap_or(0);
    let rules = yaml_sequence(config, "rules")
        .map(|items| items.len())
        .unwrap_or(0);
    if proxies == 0 {
        return Err("subscription contains no usable proxies".to_string());
    }
    Ok(ProfileSourceSummary {
        format: format.to_string(),
        proxies,
        proxy_groups,
        rules,
        unsupported_lines,
    })
}

fn yaml_key(key: &str) -> YamlValue {
    YamlValue::String(key.to_string())
}

fn yaml_sequence<'a>(config: &'a YamlValue, key: &str) -> Option<&'a Vec<YamlValue>> {
    config.get(yaml_key(key)).and_then(YamlValue::as_sequence)
}

fn decode_base64_text(input: &str) -> Option<String> {
    let normalized = input.trim().replace(['\r', '\n', ' '], "");
    let padded = match normalized.len() % 4 {
        0 => normalized,
        missing => format!("{}{}", normalized, "=".repeat(4 - missing)),
    };
    general_purpose::STANDARD
        .decode(padded)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn decode_uri_base64(input: &str) -> Option<String> {
    let compact = input.trim().replace(['\r', '\n', ' '], "");
    if compact.is_empty() {
        return None;
    }
    let padded = match compact.len() % 4 {
        2 => format!("{compact}=="),
        3 => format!("{compact}="),
        _ => compact,
    };
    general_purpose::STANDARD
        .decode(&padded)
        .or_else(|_| general_purpose::URL_SAFE.decode(&padded))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn yaml_str(value: impl Into<String>) -> YamlValue {
    YamlValue::String(value.into())
}

fn yaml_num(value: u64) -> YamlValue {
    YamlValue::Number(value.into())
}

fn set_yaml(config: &mut Mapping, key: &str, value: YamlValue) {
    config.insert(yaml_str(key), value);
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                out.push(hex);
                index += 3;
                continue;
            }
        }
        out.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (candidate, value) = pair.split_once('=')?;
        (candidate == key).then(|| percent_decode(value))
    })
}

fn query_value_any(query: &str, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| query_value(query, key))
}

fn uri_name(name_part: &str, fallback: impl Into<String>) -> String {
    if name_part.is_empty() {
        fallback.into()
    } else {
        percent_decode(name_part)
    }
}

fn truthy(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn set_bool_query(map: &mut Mapping, key: &str, query: &str, params: &[&str]) {
    if let Some(value) = query_value_any(query, params) {
        set_yaml(map, key, YamlValue::Bool(truthy(&value)));
    }
}

fn set_string_query(map: &mut Mapping, key: &str, query: &str, params: &[&str]) {
    if let Some(value) = query_value_any(query, params).filter(|value| !value.is_empty()) {
        set_yaml(map, key, yaml_str(value));
    }
}

fn set_alpn_query(map: &mut Mapping, query: &str) {
    if let Some(alpn) = query_value(query, "alpn").filter(|value| !value.is_empty()) {
        set_yaml(
            map,
            "alpn",
            YamlValue::Sequence(
                alpn.split(',')
                    .filter(|item| !item.is_empty())
                    .map(|item| yaml_str(item.to_string()))
                    .collect(),
            ),
        );
    }
}

fn parse_plugin_option_pairs(value: &str) -> HashMap<String, String> {
    value
        .split(';')
        .skip(1)
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            let key = key.trim().to_ascii_lowercase();
            if key.is_empty() {
                return None;
            }
            Some((key, percent_decode(value.trim())))
        })
        .collect()
}

fn set_ss_plugin_query(map: &mut Mapping, query: &str) {
    let Some(plugin_value) = query_value(query, "plugin").filter(|value| !value.trim().is_empty())
    else {
        return;
    };
    let plugin_name = plugin_value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let normalized_plugin = if plugin_name.contains("obfs") {
        "obfs"
    } else if plugin_name.contains("v2ray") {
        "v2ray-plugin"
    } else {
        plugin_name.as_str()
    };
    if normalized_plugin.is_empty() {
        return;
    }
    set_yaml(map, "plugin", yaml_str(normalized_plugin));

    let mut option_pairs = parse_plugin_option_pairs(&plugin_value);
    for key in ["obfs", "obfs-host", "host", "path", "mode", "tls"] {
        if let Some(value) = query_value(query, key) {
            option_pairs.insert(key.to_string(), value);
        }
    }

    let mut opts = Mapping::new();
    if normalized_plugin == "obfs" {
        let mode = option_pairs
            .get("obfs")
            .or_else(|| option_pairs.get("mode"))
            .map(String::as_str)
            .unwrap_or("http");
        set_yaml(&mut opts, "mode", yaml_str(mode));
        if let Some(host) = option_pairs
            .get("obfs-host")
            .or_else(|| option_pairs.get("host"))
            .filter(|value| !value.trim().is_empty())
        {
            set_yaml(&mut opts, "host", yaml_str(host));
        }
    } else {
        for (key, value) in option_pairs {
            if value.trim().is_empty() {
                continue;
            }
            if key == "tls" {
                set_yaml(&mut opts, "tls", YamlValue::Bool(truthy(&value)));
            } else {
                set_yaml(&mut opts, &key, yaml_str(value));
            }
        }
    }
    if !opts.is_empty() {
        set_yaml(map, "plugin-opts", YamlValue::Mapping(opts));
    }
}

pub(crate) fn parse_ss_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("ss://")?;
    let (body, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let name = uri_name(name_part, format!("SS {index}"));
    let (body, query) = body.split_once('?').unwrap_or((body, ""));
    let decoded = if body.contains('@') {
        percent_decode(body)
    } else {
        decode_uri_base64(body)?
    };
    let (auth, host_port) = decoded.rsplit_once('@')?;
    let (method, password) = auth.split_once(':')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(&mut map, "name", yaml_str(name));
    set_yaml(&mut map, "type", yaml_str("ss"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "cipher", yaml_str(method));
    set_yaml(&mut map, "password", yaml_str(password));
    set_ss_plugin_query(&mut map, query);
    Some(YamlValue::Mapping(map))
}

fn parse_trojan_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("trojan://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (password, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("Trojan {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("trojan"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    if let Some(sni) = query_value(query, "sni").or_else(|| query_value(query, "peer")) {
        set_yaml(&mut map, "sni", yaml_str(sni));
    }
    Some(YamlValue::Mapping(map))
}

fn parse_vmess_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("vmess://")?;
    let decoded = decode_uri_base64(raw)?;
    let data: JsonValue = serde_json::from_str(&decoded).ok()?;
    let server = data.get("add")?.as_str()?;
    let port = data.get("port")?.as_str()?.parse().ok()?;
    let uuid = data.get("id")?.as_str()?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(
            data.get("ps")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(percent_decode)
                .unwrap_or_else(|| format!("VMess {index}")),
        ),
    );
    set_yaml(&mut map, "type", yaml_str("vmess"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port));
    set_yaml(&mut map, "uuid", yaml_str(uuid));
    set_yaml(
        &mut map,
        "alterId",
        yaml_num(
            data.get("aid")
                .and_then(|value| value.as_str())
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
        ),
    );
    set_yaml(
        &mut map,
        "cipher",
        yaml_str(
            data.get("scy")
                .and_then(|value| value.as_str())
                .unwrap_or("auto"),
        ),
    );
    if matches!(
        data.get("tls").and_then(|value| value.as_str()),
        Some("tls")
    ) {
        set_yaml(&mut map, "tls", YamlValue::Bool(true));
    }
    if let Some(network) = data
        .get("net")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
    {
        set_yaml(&mut map, "network", yaml_str(network));
    }
    Some(YamlValue::Mapping(map))
}

fn parse_vless_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("vless://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (uuid, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let security = query_value(query, "security")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let network = query_value_any(query, &["type", "network"]).unwrap_or_else(|| "tcp".to_string());
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("VLESS {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("vless"));
    set_yaml(&mut map, "server", yaml_str(percent_decode(server)));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "uuid", yaml_str(percent_decode(uuid)));
    set_yaml(&mut map, "network", yaml_str(network.clone()));
    set_yaml(&mut map, "udp", YamlValue::Bool(true));
    set_string_query(&mut map, "flow", query, &["flow"]);
    set_string_query(
        &mut map,
        "servername",
        query,
        &["sni", "servername", "peer"],
    );
    set_string_query(
        &mut map,
        "client-fingerprint",
        query,
        &["fp", "fingerprint"],
    );
    set_bool_query(
        &mut map,
        "skip-cert-verify",
        query,
        &["allowInsecure", "insecure", "skip-cert-verify"],
    );
    if matches!(security.as_str(), "tls" | "reality") {
        set_yaml(&mut map, "tls", YamlValue::Bool(true));
    }
    if security == "reality" {
        let mut reality = Mapping::new();
        if let Some(public_key) = query_value_any(query, &["pbk", "public-key", "publicKey"]) {
            set_yaml(&mut reality, "public-key", yaml_str(public_key));
        }
        if let Some(short_id) = query_value_any(query, &["sid", "short-id", "shortId"]) {
            set_yaml(&mut reality, "short-id", yaml_str(short_id));
        }
        if !reality.is_empty() {
            set_yaml(&mut map, "reality-opts", YamlValue::Mapping(reality));
        }
    }
    if network == "ws" {
        let mut ws_opts = Mapping::new();
        if let Some(path) = query_value(query, "path") {
            set_yaml(&mut ws_opts, "path", yaml_str(path));
        }
        if let Some(host) = query_value_any(query, &["host", "headers"]) {
            let mut headers = Mapping::new();
            set_yaml(&mut headers, "Host", yaml_str(host));
            set_yaml(&mut ws_opts, "headers", YamlValue::Mapping(headers));
        }
        if !ws_opts.is_empty() {
            set_yaml(&mut map, "ws-opts", YamlValue::Mapping(ws_opts));
        }
    }
    if network == "grpc" {
        let mut grpc_opts = Mapping::new();
        if let Some(service_name) = query_value_any(query, &["serviceName", "service-name"]) {
            set_yaml(&mut grpc_opts, "grpc-service-name", yaml_str(service_name));
        }
        if !grpc_opts.is_empty() {
            set_yaml(&mut map, "grpc-opts", YamlValue::Mapping(grpc_opts));
        }
    }
    Some(YamlValue::Mapping(map))
}

fn parse_hysteria2_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri
        .strip_prefix("hysteria2://")
        .or_else(|| uri.strip_prefix("hy2://"))?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (password, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("Hysteria2 {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("hysteria2"));
    set_yaml(&mut map, "server", yaml_str(percent_decode(server)));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    set_string_query(&mut map, "sni", query, &["sni", "peer"]);
    set_bool_query(
        &mut map,
        "skip-cert-verify",
        query,
        &["insecure", "allowInsecure", "skip-cert-verify"],
    );
    set_string_query(&mut map, "obfs", query, &["obfs"]);
    set_string_query(
        &mut map,
        "obfs-password",
        query,
        &["obfs-password", "obfs_password", "obfsPassword"],
    );
    set_alpn_query(&mut map, query);
    Some(YamlValue::Mapping(map))
}

fn parse_anytls_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("anytls://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (password, host_port) = main.split_once('@')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("AnyTLS {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("anytls"));
    set_yaml(&mut map, "server", yaml_str(percent_decode(server)));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    set_string_query(&mut map, "sni", query, &["sni", "servername", "peer"]);
    set_string_query(
        &mut map,
        "client-fingerprint",
        query,
        &["fp", "fingerprint"],
    );
    set_bool_query(
        &mut map,
        "skip-cert-verify",
        query,
        &["insecure", "allowInsecure", "skip-cert-verify"],
    );
    set_alpn_query(&mut map, query);
    Some(YamlValue::Mapping(map))
}

fn parse_tuic_uri(uri: &str, index: usize) -> Option<YamlValue> {
    let raw = uri.strip_prefix("tuic://")?;
    let (before_name, name_part) = raw.split_once('#').unwrap_or((raw, ""));
    let (main, query) = before_name.split_once('?').unwrap_or((before_name, ""));
    let (auth, host_port) = main.split_once('@')?;
    let (uuid, password) = auth.split_once(':')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let mut map = Mapping::new();
    set_yaml(
        &mut map,
        "name",
        yaml_str(uri_name(name_part, format!("TUIC {index}"))),
    );
    set_yaml(&mut map, "type", yaml_str("tuic"));
    set_yaml(&mut map, "server", yaml_str(server));
    set_yaml(&mut map, "port", yaml_num(port.parse().ok()?));
    set_yaml(&mut map, "uuid", yaml_str(percent_decode(uuid)));
    set_yaml(&mut map, "password", yaml_str(percent_decode(password)));
    if let Some(sni) = query_value(query, "sni") {
        set_yaml(&mut map, "sni", yaml_str(sni));
    }
    set_alpn_query(&mut map, query);
    if let Some(fingerprint) = query_value(query, "fp") {
        set_yaml(&mut map, "client-fingerprint", yaml_str(fingerprint));
    }
    if let Some(congestion) = query_value(query, "congestion_control") {
        set_yaml(&mut map, "congestion-controller", yaml_str(congestion));
    }
    if let Some(mode) = query_value(query, "udp_relay_mode") {
        set_yaml(&mut map, "udp-relay-mode", yaml_str(mode));
    }
    if let Some(reduce_rtt) = query_value(query, "reduce_rtt") {
        set_yaml(&mut map, "reduce-rtt", YamlValue::Bool(truthy(&reduce_rtt)));
    }
    if let Some(udp) = query_value(query, "udp") {
        set_yaml(&mut map, "udp", YamlValue::Bool(truthy(&udp)));
    }
    if let Some(fast_open) = query_value(query, "tfo") {
        set_yaml(&mut map, "fast-open", YamlValue::Bool(truthy(&fast_open)));
    }
    Some(YamlValue::Mapping(map))
}

pub(crate) fn parse_uri_subscription(text: &str) -> Option<YamlValue> {
    let body = decoded_body(text);
    let proxies = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_line(line))
        .enumerate()
        .filter_map(
            |(index, line)| match line.split_once("://").map(|item| item.0) {
                Some("ss") => parse_ss_uri(line, index + 1),
                Some("trojan") => parse_trojan_uri(line, index + 1),
                Some("vmess") => parse_vmess_uri(line, index + 1),
                Some("vless") => parse_vless_uri(line, index + 1),
                Some("hysteria2" | "hy2") => parse_hysteria2_uri(line, index + 1),
                Some("anytls") => parse_anytls_uri(line, index + 1),
                Some("tuic") => parse_tuic_uri(line, index + 1),
                _ => None,
            },
        )
        .collect::<Vec<_>>();
    if proxies.is_empty() {
        return None;
    }
    let mut root = Mapping::new();
    set_yaml(&mut root, "proxies", YamlValue::Sequence(proxies));
    Some(YamlValue::Mapping(root))
}

pub(crate) fn parse_uri_source(text: &str) -> Result<ProfileSource, String> {
    let config = parse_uri_subscription(text).ok_or_else(|| {
        let unsupported = unsupported_uri_schemes(text, AEGOS_URI_PROTOCOLS);
        if unsupported.is_empty() {
            diagnostic(
                "unsupported-format",
                "content is not Clash YAML and no supported proxy URI lines were found",
                "use a Clash/Mihomo subscription, or URI lines for ss/vmess/vless/trojan/hysteria2/anytls/tuic",
            )
        } else {
            diagnostic(
                "unsupported-protocol",
                format!("unsupported URI protocol(s): {}", unsupported.join(", ")),
                "switch the subscription protocol to Clash/Mihomo, or import a protocol supported by the current bundled core",
            )
        }
    })?;
    let body = decoded_body(text);
    let unsupported_lines = body
        .lines()
        .map(str::trim)
        .filter(|line| !is_ignorable_line(line))
        .filter(|line| {
            let scheme = line.split_once("://").map(|item| item.0);
            !scheme.is_some_and(|scheme| AEGOS_URI_PROTOCOLS.contains(&scheme))
        })
        .count();
    let summary = summarize_source(&config, "uri", unsupported_lines).map_err(|err| {
        diagnostic(
            "empty-proxies",
            err,
            "check the subscription content and retry",
        )
    })?;
    Ok(ProfileSource { config, summary })
}

pub(crate) fn parse_source_text(text: &str) -> Result<ProfileSource, String> {
    let source_text = decoded_body(text);
    match serde_yaml::from_str::<YamlValue>(&source_text) {
        Ok(YamlValue::Mapping(map)) => {
            let config = YamlValue::Mapping(map);
            let summary = summarize_source(&config, "clash-yaml", 0).map_err(|err| {
                diagnostic(
                    "empty-proxies",
                    err,
                    "check whether the subscription contains usable proxy nodes",
                )
            })?;
            Ok(ProfileSource { config, summary })
        }
        Ok(_) => parse_uri_source(&source_text),
        Err(err) => {
            if looks_like_clash_yaml(&source_text) {
                return Err(diagnostic(
                    "yaml-parse",
                    format!("Clash YAML parse failed: {err}"),
                    "open the subscription in the airport panel and choose a Clash/Mihomo format, then retry",
                ));
            }
            parse_uri_source(&source_text)
        }
    }
}

pub(crate) fn download_source_url(url: &str, user_agent: &str) -> Result<ProfileSource, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| {
        diagnostic(
            "invalid-url",
            format!("invalid subscription URL: {err}"),
            "copy the full airport subscription URL again and make sure it starts with http:// or https://",
        )
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(diagnostic(
            "invalid-url",
            format!("unsupported URL scheme: {}", parsed.scheme()),
            "Aegos imports remote subscriptions through HTTP/HTTPS URLs; paste the airport subscription link instead of a local or custom scheme",
        ));
    }
    let text = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| {
            diagnostic(
                "download-client",
                format!("download client init failed: {err}"),
                "restart Aegos and retry; if it repeats, export logs for diagnosis",
            )
        })?
        .get(url)
        .header("User-Agent", user_agent)
        .send()
        .map_err(|err| {
            diagnostic(
                "download-failed",
                format!("subscription download failed: {err}"),
                "check system proxy/network reachability, then retry updating the subscription",
            )
        })?
        .error_for_status()
        .map_err(|err| {
            diagnostic(
                "http-status",
                format!("subscription download failed: bad HTTP status: {err}"),
                "check whether the subscription is expired, token is wrong, or the airport blocks this request",
            )
        })?
        .text()
        .map_err(|err| {
            diagnostic(
                "read-failed",
                format!("subscription read failed: {err}"),
                "retry once; if it repeats, the server may be returning malformed content",
            )
        })?;
    if text.trim().is_empty() {
        return Err(diagnostic(
            "empty-content",
            "subscription download returned empty content",
            "check whether the subscription token is expired or the airport returned an empty plan",
        ));
    }
    parse_source_text(&text)
}
