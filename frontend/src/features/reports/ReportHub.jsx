import { isCoogee } from "../clients/clients";
import { ClientReport } from "./ClientReport";
import { isPreparedPeriod } from "./periods";
import { PreparedReport } from "./prepared/PreparedReport";

export const REPORT_SECTIONS = [["client", "Report"]];

/**
 * Report area. Coogee's September 2026 report is the prepared Komosion report; every other client and
 * period is generated from the client's saved Rankscale records.
 */
function ReportHub({ selectedClient, account, onStartReview, onCreateReport, reportRequest, onReportSaved, overviewSource = "rankscale", onTeamReview }) {
  const showPrepared = isCoogee(selectedClient) && ["prepared", "example"].includes(overviewSource);

  function requestReport(period) {
    onCreateReport?.({ clientId: String(selectedClient.id), period, source: isPreparedPeriod(selectedClient, period) ? "prepared" : "rankscale" });
  }

  return (
    <>
      {showPrepared ? (
        <PreparedReport onPeriodApply={requestReport} client={selectedClient} onTeamReview={onTeamReview} />
      ) : (
        <ClientReport
          onPeriodApply={requestReport}
          client={selectedClient}
          account={account}
          request={reportRequest}
          onUpload={onStartReview}
          onReportSaved={onReportSaved}
          onTeamReview={onTeamReview}
        />
      )}
    </>
  );
}
export { ReportHub };
