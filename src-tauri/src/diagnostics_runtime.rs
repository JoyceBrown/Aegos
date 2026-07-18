use serde::Serialize;
use serde_json::{json, Value as JsonValue};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub type LogStore = Arc<Mutex<Vec<LogEntry>>>;

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub at: String,
    pub level: String,
    pub category: String,
    pub line: String,
}

pub struct LogsExportDocument {
    pub content: String,
    pub categories: HashMap<String, usize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AegosIssue {
    pub code: String,
    pub category: String,
    pub title: String,
    pub explanation: String,
    pub action: String,
    pub repair_kind: Option<String>,
    pub repair_label: Option<String>,
}

impl AegosIssue {
    pub fn public_message(&self) -> String {
        format!("[{}] {}：{}", self.code, self.title, self.explanation)
    }
}

fn issue(
    code: &str,
    category: &str,
    title: &str,
    explanation: &str,
    action: &str,
    repair_kind: Option<&str>,
    repair_label: Option<&str>,
) -> AegosIssue {
    AegosIssue {
        code: code.to_string(),
        category: category.to_string(),
        title: title.to_string(),
        explanation: explanation.to_string(),
        action: action.to_string(),
        repair_kind: repair_kind.map(str::to_string),
        repair_label: repair_label.map(str::to_string),
    }
}

pub fn issue_from_failure(context: &str, classification: &str, reason: &str) -> AegosIssue {
    let context_lower = context.to_ascii_lowercase();
    let reason_lower = reason.to_ascii_lowercase();
    if context_lower.contains("refreshoutboundip") {
        if reason_lower.contains("requires an active or standby connection") {
            return issue(
                "AEG-IP-001",
                "connection",
                "连接后才能查询落地 IP",
                "当前网络核心尚未运行，没有可用于查询的节点出口。",
                "先连接节点，或开始一次节点测速后再查询。",
                None,
                None,
            );
        }
        if reason_lower.contains("route sync")
            || reason_lower.contains("not available in the outbound ip route")
            || reason_lower.contains("proxy not exist")
        {
            return issue(
                "AEG-IP-002",
                "connection",
                "当前节点出口同步失败",
                "Aegos 没能把落地 IP 查询绑定到当前真实节点。",
                "刷新节点列表并重新选择节点；问题仍存在时运行诊断。",
                None,
                None,
            );
        }
        if reason_lower.contains("expired after node changed") {
            return issue(
                "AEG-IP-003",
                "connection",
                "节点已切换，请重新查询",
                "查询期间当前节点发生变化，旧结果已被安全丢弃。",
                "等待节点切换完成后再次查询落地 IP。",
                None,
                None,
            );
        }
        return issue(
            "AEG-IP-004",
            "connection",
            "暂时无法获取落地 IP",
            "当前节点已选中，但多个出口查询服务均未返回有效 IP。",
            "确认节点可以访问网络后重试；其他网站正常时稍后再查。",
            None,
            None,
        );
    }
    if context_lower.contains("profile") || context_lower.contains("subscription") {
        if reason_lower.contains("invalid-url") {
            return issue(
                "AEG-SUB-001",
                "subscription",
                "订阅地址无效",
                "订阅链接不完整或不是 HTTP/HTTPS 地址。",
                "重新复制机场提供的完整订阅链接。",
                None,
                None,
            );
        }
        if reason_lower.contains("http-status") || classification == "auth" {
            return issue(
                "AEG-SUB-003",
                "subscription",
                "订阅授权失败",
                "订阅已过期、令牌无效，或服务商拒绝了请求。",
                "在机场面板重新生成订阅链接；仍失败时联系服务商。",
                None,
                None,
            );
        }
        if reason_lower.contains("unsupported-protocol") || classification == "unsupported-protocol"
        {
            return issue(
                "AEG-SUB-005",
                "subscription",
                "订阅协议暂不支持",
                "订阅包含当前版本无法导入的协议。",
                "在机场面板选择 Clash/Mihomo 格式后重新导入。",
                None,
                None,
            );
        }
        if reason_lower.contains("yaml-parse")
            || reason_lower.contains("unsupported-format")
            || classification == "config"
        {
            return issue(
                "AEG-SUB-004",
                "subscription",
                "订阅格式无法识别",
                "返回内容不是有效的 Clash/Mihomo 配置或节点链接。",
                "切换订阅格式并重试；不要粘贴网页地址或说明文字。",
                None,
                None,
            );
        }
        if reason_lower.contains("empty") {
            return issue(
                "AEG-SUB-006",
                "subscription",
                "订阅没有可用节点",
                "服务端返回了空内容，或内容中没有可用节点。",
                "检查套餐状态和订阅令牌，必要时联系服务商。",
                None,
                None,
            );
        }
        return issue(
            "AEG-SUB-002",
            "subscription",
            "订阅下载失败",
            "Aegos 无法从订阅服务器取得有效内容。",
            "检查当前网络后重试；其他网站正常时联系订阅服务商。",
            None,
            None,
        );
    }
    match classification {
        "timeout" => issue(
            "AEG-NOD-001",
            "node",
            "节点响应超时",
            "节点在限定时间内没有完成连接。",
            "稍后重试或选择同地区的其他节点。",
            None,
            None,
        ),
        "dns" | "dns-fake-ip" => issue(
            "AEG-DNS-001",
            "dns",
            "DNS 解析异常",
            "节点域名没有得到可用地址，或受到其他代理的 DNS 影响。",
            "关闭其他代理/VPN 后重试，或重启 Aegos 网络核心。",
            Some("restart-core"),
            Some("重启网络核心"),
        ),
        "tls" => issue(
            "AEG-NOD-002",
            "node",
            "安全握手失败",
            "节点证书、时间或传输参数不匹配。",
            "校准系统时间；仍失败时更新订阅或联系服务商。",
            None,
            None,
        ),
        "auth" => issue(
            "AEG-NOD-003",
            "node",
            "节点认证失败",
            "节点凭据已失效或服务端拒绝认证。",
            "更新订阅；若其他节点正常，请联系服务商处理该节点。",
            None,
            None,
        ),
        "refused" => issue(
            "AEG-NOD-004",
            "node",
            "节点拒绝连接",
            "远端节点主动拒绝或重置了连接。",
            "更新订阅后重试；若只有该节点失败，请联系服务商。",
            None,
            None,
        ),
        "node-not-found" => issue(
            "AEG-NOD-006",
            "node",
            "节点已不存在",
            "该节点已被订阅更新移除，或当前已切换到其他订阅。",
            "刷新节点列表并重新选择节点。",
            None,
            None,
        ),
        "blocked" | "protection-blocked" => issue(
            "AEG-FW-002",
            "firewall",
            "连接被保护规则阻止",
            "断网保护或系统防火墙阻止了此次连接。",
            "让 Aegos 清理自身防火墙规则后重试。",
            Some("cleanup-firewall"),
            Some("清理防火墙规则"),
        ),
        "unsupported-protocol" => issue(
            "AEG-NOD-005",
            "node",
            "节点协议暂不支持",
            "当前网络核心无法运行该节点协议或参数。",
            "更新订阅格式或选择其他节点。",
            None,
            None,
        ),
        "port-conflict" => issue(
            "AEG-CON-002",
            "connection",
            "代理端口被占用",
            "其他程序正在使用 Aegos 需要的端口。",
            "自动改用可用端口，或关闭占用端口的程序。",
            Some("recommended-ports"),
            Some("改用可用端口"),
        ),
        "controller-unavailable" => issue(
            "AEG-CON-003",
            "connection",
            "网络核心没有响应",
            "Aegos 暂时无法联系本地网络核心。",
            "重启网络核心后再次连接。",
            Some("restart-core"),
            Some("重启网络核心"),
        ),
        "config" => issue(
            "AEG-CON-004",
            "connection",
            "运行配置无效",
            "当前订阅或设置无法生成可运行配置。",
            "更新订阅并检查分流规则；失败配置不会覆盖当前配置。",
            None,
            None,
        ),
        "unreachable" | "node-connect" | "network" => issue(
            "AEG-CON-001",
            "connection",
            "网络无法建立连接",
            "当前网络或节点线路不可达。",
            "检查本机网络，关闭冲突的 VPN/代理后重试。",
            Some("recover-network"),
            Some("修复网络连接"),
        ),
        _ => issue(
            "AEG-CON-099",
            "connection",
            "操作未完成",
            "Aegos 未能完成此次网络操作。",
            "运行诊断并导出支持报告以获得进一步定位。",
            None,
            None,
        ),
    }
}

pub fn enrich_check(mut check: JsonValue) -> JsonValue {
    let name = check
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or("Check");
    let ok = check
        .get("ok")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let technical = check
        .get("detail")
        .and_then(JsonValue::as_str)
        .unwrap_or("-")
        .to_string();
    let contract = if name.contains("Active profile") || name.contains("Profile preflight") {
        issue(
            "AEG-SUB-004",
            "subscription",
            "订阅配置检查",
            if ok {
                "当前订阅配置可以使用。"
            } else {
                "当前订阅配置不完整或无法生成运行配置。"
            },
            "更新订阅或切换到其他订阅。",
            None,
            None,
        )
    } else if name.contains("DNS") {
        issue(
            "AEG-DNS-001",
            "dns",
            "DNS 安全检查",
            if ok {
                "DNS 配置正常。"
            } else {
                "DNS 配置可能受到本地代理或错误解析结果影响。"
            },
            "重启网络核心；仍失败时关闭其他代理/VPN。",
            Some("restart-core"),
            Some("重启网络核心"),
        )
    } else if name.contains("Mixed port")
        || name.contains("Controller port")
        || name.contains("port isolation")
    {
        issue(
            "AEG-CON-002",
            "connection",
            "端口可用性",
            if ok {
                "Aegos 所需端口可用。"
            } else {
                "Aegos 所需端口被占用或与其他端口冲突。"
            },
            "自动选择可用端口，或关闭占用程序。",
            Some("recommended-ports"),
            Some("改用可用端口"),
        )
    } else if name.contains("System Proxy") || name.contains("System proxy") {
        issue(
            "AEG-PRX-001",
            "system-proxy",
            "系统代理接管",
            if ok {
                "Windows 系统代理状态正常。"
            } else {
                "Windows 系统代理没有指向 Aegos，或旧设置没有完整恢复。"
            },
            "重新建立并验证系统代理接管。",
            Some("system-proxy"),
            Some("修复系统代理"),
        )
    } else if name == "TUN"
        || (name == "Administrator" && technical.to_ascii_lowercase().contains("tun"))
    {
        issue(
            "AEG-TUN-001",
            "tun",
            "TUN 权限与状态",
            if ok {
                "TUN 当前具备运行条件。"
            } else {
                "TUN 需要管理员权限，或虚拟网卡没有正确接管路由。"
            },
            "以管理员身份重新启动 Aegos。",
            Some("relaunch-admin"),
            Some("以管理员身份重启"),
        )
    } else if name.contains("Disconnect protection") {
        issue(
            "AEG-FW-001",
            "firewall",
            "断网保护状态",
            if ok {
                "断网保护规则状态正常。"
            } else {
                "断网保护权限不足或规则没有正确应用。"
            },
            "清理 Aegos 防火墙规则后重新开启。",
            Some("cleanup-firewall"),
            Some("清理防火墙规则"),
        )
    } else if name.contains("Proxy and VPN conflicts") {
        issue(
            "AEG-CON-005",
            "connection",
            "其他代理或 VPN 冲突",
            if ok {
                "未发现会竞争端口、路由或 DNS 的程序。"
            } else {
                "检测到其他代理、VPN、端口或虚拟网卡可能影响 Aegos。"
            },
            "关闭冲突程序后重试；Aegos 不会擅自结束其他程序。",
            None,
            None,
        )
    } else if name.contains("Recent core logs") {
        issue(
            "AEG-NOD-099",
            "node",
            "近期网络异常",
            if ok {
                "近期没有发现网络核心异常。"
            } else {
                "近期日志中出现了需要关注的节点或网络错误。"
            },
            "查看运行日志中的对应错误，或测试其他节点。",
            None,
            None,
        )
    } else {
        issue(
            "AEG-CON-001",
            "connection",
            "连接运行检查",
            if ok {
                "该项运行状态正常。"
            } else {
                "Aegos 的连接运行条件不完整。"
            },
            "重启网络核心后重新连接。",
            Some("restart-core"),
            Some("重启网络核心"),
        )
    };
    if let Some(object) = check.as_object_mut() {
        object.insert("code".to_string(), json!(contract.code));
        object.insert("category".to_string(), json!(contract.category));
        object.insert("title".to_string(), json!(contract.title));
        object.insert("detail".to_string(), json!(contract.explanation));
        object.insert("technicalDetail".to_string(), json!(technical));
        object.insert(
            "hint".to_string(),
            json!(if ok { "".to_string() } else { contract.action }),
        );
        object.insert(
            "repair".to_string(),
            json!({
                "kind": contract.repair_kind,
                "label": contract.repair_label,
                "available": !ok && contract.repair_kind.is_some()
            }),
        );
    }
    check
}

pub fn logs_export_document(
    items: &[LogEntry],
    generated_at: &str,
    sanitizer: fn(&str) -> String,
) -> LogsExportDocument {
    let mut categories: HashMap<String, usize> = HashMap::new();
    for entry in items {
        *categories.entry(entry.category.clone()).or_insert(0) += 1;
    }
    let mut category_lines = categories
        .iter()
        .map(|(category, count)| format!("- {category}: {count}"))
        .collect::<Vec<_>>();
    category_lines.sort();
    let header = format!(
        "Aegos Logs Export\nGenerated: {generated_at}\nEntries: {}\nRedaction: subscription URLs, tokens, UUIDs, passwords, local paths, and sensitive IPs are masked before export.\nCategories:\n{}\n\n",
        items.len(),
        if category_lines.is_empty() {
            "- none".to_string()
        } else {
            category_lines.join("\n")
        }
    );
    let content = if items.is_empty() {
        format!("{header}No Aegos logs captured yet.\n")
    } else {
        header
            + &items
                .iter()
                .map(|entry| {
                    let line = sanitizer(&entry.line).replace('\r', " ").replace('\n', " ");
                    format!("{} [{}:{}] {}", entry.at, entry.level, entry.category, line)
                })
                .collect::<Vec<_>>()
                .join("\n")
            + "\n"
    };
    LogsExportDocument {
        content,
        categories,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_sanitizer(value: &str) -> String {
        value.replace("secret", "[redacted]")
    }

    #[test]
    fn log_export_document_counts_categories_and_sanitizes_lines() {
        let items = vec![
            LogEntry {
                at: "now".to_string(),
                level: "info".to_string(),
                category: "core".to_string(),
                line: "core secret line".to_string(),
            },
            LogEntry {
                at: "now".to_string(),
                level: "warn".to_string(),
                category: "diagnostic".to_string(),
                line: "plain".to_string(),
            },
        ];

        let document = logs_export_document(&items, "generated", test_sanitizer);
        assert_eq!(document.categories.get("core"), Some(&1));
        assert_eq!(document.categories.get("diagnostic"), Some(&1));
        assert!(document.content.contains("[redacted]"));
        assert!(!document.content.contains("secret line"));
    }

    #[test]
    fn aegos_issues_hide_raw_engine_errors_and_keep_actions_structured() {
        let issue = issue_from_failure("changeProxy", "tls", "mihomo x509 raw failure");
        assert_eq!(issue.code, "AEG-NOD-002");
        assert_eq!(issue.category, "node");
        assert!(!issue.public_message().contains("mihomo"));
        assert!(!issue.public_message().contains("x509"));

        let check = enrich_check(json!({
            "name": "Mixed port availability",
            "ok": false,
            "detail": "PID 1234 owns 7891",
            "severity": "error",
            "category": "network",
            "hint": "change port"
        }));
        assert_eq!(
            check.get("code").and_then(JsonValue::as_str),
            Some("AEG-CON-002")
        );
        assert_eq!(
            check.pointer("/repair/kind").and_then(JsonValue::as_str),
            Some("recommended-ports")
        );
        assert_ne!(check.get("detail"), check.get("technicalDetail"));

        let refused = issue_from_failure("node", "refused", "connection refused by peer");
        assert_eq!(refused.code, "AEG-NOD-004");
        assert!(!refused.public_message().contains("connection refused"));

        let disconnected = issue_from_failure(
            "refreshOutboundIp",
            "unknown",
            "Outbound IP requires an active or standby connection.",
        );
        assert_eq!(disconnected.code, "AEG-IP-001");
        assert!(disconnected.public_message().contains("连接后才能查询落地 IP"));

        let route_sync = issue_from_failure(
            "refreshOutboundIp",
            "controller-unavailable",
            "Outbound IP route sync failed: proxy not exist",
        );
        assert_eq!(route_sync.code, "AEG-IP-002");

        let stale = issue_from_failure(
            "refreshOutboundIp",
            "unknown",
            "Outbound IP query expired after node changed",
        );
        assert_eq!(stale.code, "AEG-IP-003");
    }
}
