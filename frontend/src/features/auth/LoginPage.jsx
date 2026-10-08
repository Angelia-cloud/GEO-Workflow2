import { komosionLogo } from "../../assets/index";
import { useEffect, useState } from "react";
import { DEFAULT_ACCOUNT, initialsOf, loadTeam } from "./account";

/** Sign-in screen: continue as the team account the workspace knows about. */
function LoginPage({ onSignIn }) {
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  useEffect(() => {
    loadTeam().then((team) => setAccount(team[0]));
  }, []);
  return (
    <main className="workspace-login">
      <section className="workspace-login-brand">
        <img src={komosionLogo} alt="Komosion" />
        <div>
          <p className="workspace-login-product">
            {"GEO "}
            <span>·</span>
            {" AI"}
          </p>
          <h1>
            From setup
            <br />
            {" to clear next steps."}
          </h1>
          <p>Track, review and improve your visibility in AI search.</p>
        </div>
        <div className="workspace-login-phases">
          <div>
            <span>01</span>
            <div>
              <strong>Prompt</strong>
              <p>Client, transcript, intents and prompts</p>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <strong>Rankscale</strong>
              <p>Upload data, then explore your report</p>
            </div>
          </div>
        </div>
        <small>Helping businesses use AI to be more efficient and effective.</small>
      </section>
      <section className="workspace-login-form">
        <div>
          <span className="guided-eyebrow">KOMOSION GEO WORKSPACE</span>
          <h2>Sign in to get started</h2>
          <p>Your account keeps your uploads and reports together.</p>
          <div className="workspace-login-account">
            <span className="workspace-avatar">{initialsOf(account)}</span>
            <div>
              <strong>{account.name}</strong>
              <span>
                {"Komosion team \xB7 "}
                {account.role}
              </span>
            </div>
            <span className="guided-status">Team account</span>
          </div>
          <button className="guided-primary workspace-login-submit" onClick={() => onSignIn(account)}>
            {"Continue as "}
            {account.name}
            <span aria-hidden="true">→</span>
          </button>
          <p className="workspace-login-note">
            Uploads, reviews and reports are saved under this name. Team accounts are managed in the GEO database.
          </p>
        </div>
      </section>
    </main>
  );
}
export { LoginPage };
