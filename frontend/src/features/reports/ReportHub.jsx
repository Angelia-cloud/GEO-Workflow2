import { LiveReport } from "./live/LiveReport";
import { ClientReport } from "./ClientReport";

export const REPORT_SECTIONS = [["client", "Report"]];

/**
 * Every client's report is generated live from the stored Rankscale measurements for the applied dates,
 * in the approved report layout, so each import updates it. A client with no measurements yet falls back
 * to the saved-records report, which offers the upload.
 */
function ReportHub({ selectedClient, account, onStartReview, onCreateReport, reportRequest, onReportSaved, onTeamReview }) {
  function requestReport(period) {
    onCreateReport?.({ clientId: String(selectedClient.id), period, source: "rankscale" });
  }
  const savedRecordsReport = (
    <ClientReport
      onPeriodApply={requestReport}
      client={selectedClient}
      account={account}
      request={reportRequest}
      onUpload={onStartReview}
      onReportSaved={onReportSaved}
      onTeamReview={onTeamReview}
    />
  );
  if (!selectedClient?.id) return savedRecordsReport;
  return <LiveReport key={selectedClient.id} client={selectedClient} account={account} emptyState={savedRecordsReport} onTeamReview={onTeamReview} />;
}
export { ReportHub };
