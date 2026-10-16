import { Component } from "react";
import { LiveReport } from "./live/LiveReport";
import { ClientReport } from "./ClientReport";

/** A report that fails to render shows a message (and the saved-records report) instead of a blank app. */
class ReportBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Report could not be displayed", error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <div className="guided-alert" role="alert">
          The live report could not be displayed ({this.state.error.message}). The report from the saved records is shown instead.
        </div>
        {this.props.fallback}
      </>
    );
  }
}

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
  return (
    <ReportBoundary key={selectedClient.id} fallback={savedRecordsReport}>
      <LiveReport client={selectedClient} account={account} emptyState={savedRecordsReport} onTeamReview={onTeamReview} />
    </ReportBoundary>
  );
}
export { ReportHub };
