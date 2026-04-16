const SEVERITY_LABELS: Record<string, string> = { critical: "紧急", high: "高", medium: "中", low: "低" };
const ALERT_TYPE_LABELS: Record<string, string> = {
  sentiment_drop: "负面回答", fact_missing: "事实错误",
  new_negative_source: "新负面来源", coverage_decline: "覆盖率下降",
};

export function formatAlertMessage(alert: {
  alertType: string; severity: string; title: string;
  description: string | null; relatedPlatform: string | null;
  relatedQuestionId: string | null;
}): { title: string; content: string } {
  const sevLabel = SEVERITY_LABELS[alert.severity] || alert.severity;
  const typeLabel = ALERT_TYPE_LABELS[alert.alertType] || alert.alertType;
  return {
    title: `【${sevLabel}】${typeLabel} - ${alert.relatedPlatform || "未知平台"}`,
    content: alert.description || alert.title,
  };
}

export function formatBatchSummary(batch: {
  batchId: string; total: number; completed: number; failed: number;
  alertCount: number; alerts: Array<{ severity: string; title: string }>;
}): { title: string; content: string } {
  const criticalCount = batch.alerts.filter(a => a.severity === "critical").length;
  const highCount = batch.alerts.filter(a => a.severity === "high").length;
  const parts = [`采集完成：共 ${batch.total} 条，成功 ${batch.completed}，失败 ${batch.failed}`];
  if (batch.alertCount > 0) {
    parts.push(`新增 ${batch.alertCount} 条预警${criticalCount > 0 ? `（紧急 ${criticalCount}）` : ""}${highCount > 0 ? `（高 ${highCount}）` : ""}`);
  }
  return {
    title: batch.alertCount > 0 ? `【批量采集】新增 ${batch.alertCount} 条预警` : "【批量采集】完成",
    content: parts.join("\n"),
  };
}
