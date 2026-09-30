import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, jsonOptions, queryString } from "../api.js";
import { Badge, Card, Loading, Notice, PageError } from "../components.jsx";

const CATEGORIES = ["accommodation", "occasion", "dining", "wellness", "family", "business", "accessibility", "local_experience", "other"];

function Stage({ number, title, status, children }) {
  return <section className="onboarding-stage" aria-labelledby={`onboarding-stage-${number}`}>
    <div className="onboarding-stage-title">
      <span className={`onboarding-stage-number ${status === "complete" ? "complete" : ""}`}>{status === "complete" ? "✓" : number}</span>
      <div><h2 id={`onboarding-stage-${number}`}>{title}</h2><p className="sub">{status === "complete" ? "Complete" : "Next step"}</p></div>
    </div>
    <div className="onboarding-stage-content">{children}</div>
  </section>;
}

const statusTone = (status) => status === "approved" ? "good" : status === "rejected" ? "bad" : "warn";

export default function OnboardingPage({ properties, propertyId, onPropertyChange, onPropertyCreated, reviewer }) {
  const currentPropertyRef = useRef(propertyId);
  currentPropertyRef.current = propertyId;
  const [propertyForm, setPropertyForm] = useState({ name: "", brand_group: "", location: "", website_url: "", aliases: "" });
  const [clientInput, setClientInput] = useState("");
  const [runId, setRunId] = useState("");
  const [runPropertyId, setRunPropertyId] = useState("");
  const [intentCandidates, setIntentCandidates] = useState([]);
  const [intentNotes, setIntentNotes] = useState("");
  const [promptRunId, setPromptRunId] = useState("");
  const [prompts, setPrompts] = useState([]);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [intentEdit, setIntentEdit] = useState(null);
  const [promptEdit, setPromptEdit] = useState(null);
  const [newIntent, setNewIntent] = useState({ name: "", description: "", category: "other", source_reason: "Added by reviewer" });
  const [newPrompt, setNewPrompt] = useState({ intent_id: "", prompt_text: "", prompt_type: "unbranded_discovery", rationale: "" });
  const [total, setTotal] = useState(30);
  const [focus, setFocus] = useState("");

  async function loadRun(id, expectedPropertyId = propertyId, isCurrent = () => currentPropertyRef.current === expectedPropertyId) {
    const run = await api(`/api/onboarding/runs/${id}`);
    if (!isCurrent() || run.property_id !== expectedPropertyId) return false;
    setRunId(run.id);
    setRunPropertyId(run.property_id);
    setClientInput(run.client_input || "");
    setIntentCandidates(run.intent_map?.intents || []);
    setIntentNotes(run.intent_map?.notes || "");
    setPromptRunId(run.prompt_run_id || "");
    setPrompts(run.prompts || []);
    return true;
  }

  useEffect(() => {
    let active = true;
    setError(null);
    setMessage("");
    setRunId("");
    setRunPropertyId("");
    setClientInput("");
    setIntentCandidates([]);
    setIntentNotes("");
    setPromptRunId("");
    setPrompts([]);
    if (!propertyId) return () => { active = false; };
    const selectedPropertyId = propertyId;
    api(`/api/onboarding/runs?${queryString({ property_id: selectedPropertyId })}`).then(async (runs) => {
      if (active && runs.length) {
        await loadRun(runs[0].id, selectedPropertyId, () => active);
      }
    }).catch((reason) => { if (active) setError(reason); });
    return () => { active = false; };
  }, [propertyId]);

  const property = properties.find((item) => item.id === propertyId);
  const runMatchesProperty = Boolean(propertyId && runPropertyId === propertyId);
  const activeRunId = runMatchesProperty ? runId : "";
  const activePromptRunId = runMatchesProperty ? promptRunId : "";
  const visibleClientInput = runMatchesProperty ? clientInput : "";
  const visibleIntents = runMatchesProperty ? intentCandidates : [];
  const visiblePrompts = runMatchesProperty ? prompts : [];
  const visibleIntentNotes = runMatchesProperty ? intentNotes : "";
  const approvedIntents = useMemo(() => visibleIntents.filter((candidate) => candidate.status === "approved"), [visibleIntents]);
  const approvedPrompts = visiblePrompts.filter((prompt) => prompt.status === "approved");
  const rejectedPrompts = visiblePrompts.filter((prompt) => prompt.status === "rejected");
  const pendingPrompts = visiblePrompts.filter((prompt) => prompt.status === "candidate");
  const allPromptsReviewed = Boolean(activePromptRunId) && pendingPrompts.length === 0;
  const stages = [Boolean(propertyId), Boolean(activeRunId), visibleIntents.length > 0,
    visibleIntents.length > 0 && visibleIntents.every((candidate) => candidate.status !== "draft"),
    Boolean(activePromptRunId), allPromptsReviewed];

  async function createProperty(event) {
    event.preventDefault(); setBusy("property"); setError(null); setMessage("");
    try {
      const created = await api("/api/properties", jsonOptions({
        name: propertyForm.name, brand_group: propertyForm.brand_group || null,
        location: propertyForm.location || null, website_url: propertyForm.website_url || null,
        aliases: propertyForm.aliases.split(",").map((item) => item.trim()).filter(Boolean),
      }));
      onPropertyCreated(created);
      setPropertyForm({ name: "", brand_group: "", location: "", website_url: "", aliases: "" });
      setMessage(`${created.name} is now the selected property.`);
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  function startNewKickoff() {
    setRunId(""); setClientInput(""); setIntentCandidates([]); setIntentNotes("");
    setPromptRunId(""); setPrompts([]); setMessage("New kickoff draft started."); setError(null);
  }

  async function saveClientInput() {
    if (!propertyId) return setError(new Error("Select a property first."));
    const selectedPropertyId = propertyId;
    setBusy("input"); setError(null); setMessage("");
    try {
      const result = await api("/api/onboarding/runs", jsonOptions({ property_id: selectedPropertyId, client_input: clientInput, created_by: reviewer || null }));
      const loaded = await loadRun(result.id, selectedPropertyId, () => currentPropertyRef.current === selectedPropertyId);
      if (loaded) setMessage("Kickoff input saved against this property.");
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function generateIntents() {
    if (!activeRunId) return setError(new Error("Save the client input for the selected property before generating intents."));
    setBusy("intents"); setError(null); setMessage("");
    try {
      await api(`/api/onboarding/runs/${activeRunId}/generate-intents`, jsonOptions({}));
      await loadRun(activeRunId, propertyId, () => currentPropertyRef.current === propertyId);
      setMessage("Draft intent candidates generated. Review each one before prompt generation.");
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function reviewIntent(candidate, action, edits = {}) {
    if (!activeRunId) return setError(new Error("Select the property that owns these intent candidates."));
    setBusy(`intent-${candidate.candidate_id}`); setError(null);
    try {
      await api(`/api/onboarding/runs/${activeRunId}/intents/${candidate.candidate_id}/review`, jsonOptions({ action, reviewer: reviewer || "Reviewer", edits }));
      await loadRun(activeRunId, propertyId, () => currentPropertyRef.current === propertyId);
      setIntentEdit(null);
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function addIntent(event) {
    event.preventDefault(); setBusy("intent-add"); setError(null);
    try {
      if (!activeRunId) throw new Error("Save client input for the selected property first.");
      await api(`/api/onboarding/runs/${activeRunId}/intents`, jsonOptions({ ...newIntent, reviewer: reviewer || "Reviewer" }));
      await loadRun(activeRunId, propertyId, () => currentPropertyRef.current === propertyId);
      setNewIntent({ name: "", description: "", category: "other", source_reason: "Added by reviewer" });
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function generatePrompts(event) {
    event.preventDefault();
    if (!activeRunId) return setError(new Error("Save and review client input for the selected property first."));
    if (!approvedIntents.length) return setError(new Error("Approve at least one intent before generating prompts."));
    if (visibleIntents.some((candidate) => candidate.status === "draft")) return setError(new Error("Review every intent candidate before generating prompts."));
    setBusy("prompts"); setError(null); setMessage("");
    try {
      const result = await api(`/api/onboarding/runs/${activeRunId}/generate-prompts`, jsonOptions({ total: Number(total), focus: focus || null, created_by: reviewer || null }));
      await loadRun(activeRunId, propertyId, () => currentPropertyRef.current === propertyId);
      setMessage(`Prompt candidates generated: ${result.summary.drafted} drafted, ${result.summary.kept} passed QA.`);
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function reviewPrompt(prompt, action, text) {
    if (!activePromptRunId || !approvedIntents.some((candidate) => candidate.approved_intent_id === prompt.intent_id)) {
      return setError(new Error("This prompt is not linked to an approved intent for the selected property."));
    }
    setBusy(`prompt-${prompt.id}`); setError(null);
    try {
      await api(`/api/onboarding/prompts/${prompt.id}/review`, jsonOptions({ action, reviewer: reviewer || "Reviewer", prompt_text: text }));
      await loadRun(activeRunId, propertyId, () => currentPropertyRef.current === propertyId);
      setPromptEdit(null);
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  async function addPrompt(event) {
    event.preventDefault(); setBusy("prompt-add"); setError(null);
    try {
      if (!activePromptRunId) throw new Error("Generate prompts for the selected property first.");
      await api(`/api/onboarding/prompt-runs/${activePromptRunId}/prompts`, jsonOptions({
        ...newPrompt, intent_id: newPrompt.intent_id || approvedIntents[0]?.approved_intent_id,
        reviewer: reviewer || "Reviewer",
      }));
      await loadRun(activeRunId, propertyId, () => runPropertyId === propertyId);
      setNewPrompt({ intent_id: approvedIntents[0]?.approved_intent_id || "", prompt_text: "", prompt_type: "unbranded_discovery", rationale: "" });
    } catch (reason) { setError(reason); }
    finally { setBusy(""); }
  }

  const finalReady = allPromptsReviewed && approvedPrompts.length > 0;

  return <div className="onboarding-page">
    <div className="onboarding-heading"><div><div className="ph-eyebrow">Workflow 1 · one-time onboarding</div><h2>Property Setup</h2><p className="sub">Capture the client context, approve search intents, then approve the prompts sent to tracking.</p></div>
      {propertyId && <button className="secondary" type="button" onClick={startNewKickoff}>New kickoff</button>}
    </div>
    <div className="onboarding-progress" aria-label="Onboarding steps">
      {["Property", "Client Input", "Generate Intents", "Review Intents", "Generate Prompts", "Review Prompts"].map((label, index) => <div className={stages[index] ? "done" : ""} key={label}><span>{stages[index] ? "✓" : index + 1}</span>{label}</div>)}
    </div>
    <PageError error={error} />
    {message && <Notice tone="ok">{message}</Notice>}

    <Stage number="1" title="Property Setup" status={propertyId ? "complete" : "pending"}>
      <div className="row">
        <label>Select property<select value={propertyId} onChange={(event) => onPropertyChange(event.target.value)}><option value="">Choose a property</option>{properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {property && <div className="onboarding-property-summary"><strong>{property.name}</strong><span>{property.location || "Location not set"}</span><span>{property.website_url || "Website not set"}</span></div>}
      </div>
      <details><summary>Create a property</summary>
        <form className="onboarding-property-form" onSubmit={createProperty}>
          <label>Property name<input required maxLength="200" value={propertyForm.name} onChange={(event) => setPropertyForm({ ...propertyForm, name: event.target.value })} /></label>
          <label>Brand / client<input maxLength="120" value={propertyForm.brand_group} onChange={(event) => setPropertyForm({ ...propertyForm, brand_group: event.target.value })} /></label>
          <label>Location<input maxLength="240" value={propertyForm.location} onChange={(event) => setPropertyForm({ ...propertyForm, location: event.target.value })} /></label>
          <label>Website<input type="url" placeholder="https://example.com" value={propertyForm.website_url} onChange={(event) => setPropertyForm({ ...propertyForm, website_url: event.target.value })} /></label>
          <label className="wide">Known property names<input placeholder="Comma-separated aliases, if any" value={propertyForm.aliases} onChange={(event) => setPropertyForm({ ...propertyForm, aliases: event.target.value })} /></label>
          <button disabled={busy === "property"}>{busy === "property" ? "Creating…" : "Create and select property"}</button>
        </form>
      </details>
    </Stage>

    <Stage number="2" title="Client Input" status={activeRunId ? "complete" : "pending"}>
      <label className="onboarding-client-input">Kickoff notes, FAQs, guest questions, objectives or other client-provided context
        <textarea rows="8" maxLength="50000" value={visibleClientInput} onChange={(event) => setClientInput(event.target.value)} placeholder="Paste kickoff notes or customer questions. Client input is saved with the selected property." disabled={!propertyId} />
      </label>
      <div className="row"><button className="secondary" disabled={!propertyId || !clientInput.trim() || busy === "input"} onClick={saveClientInput}>{busy === "input" ? "Saving…" : "Save client input"}</button>{runId && <Badge tone="good">Saved to selected property</Badge>}</div>
    </Stage>

    <Stage number="3" title="Intent Generation" status={visibleIntents.length ? "complete" : "pending"}>
      <p className="sub">The existing Intent Mapper uses the property context, current data and saved client input. Results remain drafts until reviewed.</p>
      <button disabled={!runId || busy === "intents"} onClick={generateIntents}>{busy === "intents" ? "Generating…" : "Generate intent candidates"}</button>
      {visibleIntentNotes && <p className="muted">Agent notes: {visibleIntentNotes}</p>}
    </Stage>

    <Stage number="4" title="Human Intent Review" status={visibleIntents.length > 0 && visibleIntents.every((candidate) => candidate.status !== "draft") ? "complete" : "pending"}>
      {visibleIntents.length === 0 ? <div className="empty">Generate intent candidates to review them here.</div> : <div className="onboarding-candidate-list">
        {visibleIntents.map((candidate) => <article className="rec onboarding-candidate" key={candidate.candidate_id}>
          <div className="meta"><Badge>{candidate.category || "other"}</Badge><Badge tone={statusTone(candidate.status)}>{candidate.status}</Badge>{candidate.priority && <Badge>{candidate.priority} priority</Badge>}</div>
          {intentEdit?.candidate_id === candidate.candidate_id ? <div className="onboarding-edit-form">
            <label>Intent name<input value={intentEdit.name} onChange={(event) => setIntentEdit({ ...intentEdit, name: event.target.value })} /></label>
            <label>Category<select value={intentEdit.category} onChange={(event) => setIntentEdit({ ...intentEdit, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Description<textarea rows="2" value={intentEdit.description} onChange={(event) => setIntentEdit({ ...intentEdit, description: event.target.value })} /></label>
            <label>Source / reason<textarea rows="2" value={intentEdit.source_reason} onChange={(event) => setIntentEdit({ ...intentEdit, source_reason: event.target.value })} /></label>
            <div className="actions"><button disabled={Boolean(busy)} onClick={() => reviewIntent(candidate, "edit", intentEdit)}>Save edit</button><button className="secondary" onClick={() => setIntentEdit(null)}>Cancel</button></div>
          </div> : <>
            <h3>{candidate.name}</h3><p>{candidate.description}</p>
            <p className="muted">Source: {candidate.source_reason || "No source reason supplied"}</p>
            {candidate.source_quotes?.length > 0 && <blockquote>{candidate.source_quotes.map((quote) => <span key={quote}>“{quote}” </span>)}</blockquote>}
            {candidate.merged_sources?.length > 0 && <p className="muted">Merged {candidate.merged_sources.length} similar suggestion(s).</p>}
            {candidate.status === "draft" && <div className="actions">
              <button disabled={Boolean(busy)} onClick={() => reviewIntent(candidate, "approve")}>Approve</button>
              <button className="secondary" onClick={() => setIntentEdit({ candidate_id: candidate.candidate_id, name: candidate.name, category: candidate.category || "other", description: candidate.description || "", source_reason: candidate.source_reason || "" })}>Edit</button>
              <button className="secondary" disabled={Boolean(busy)} onClick={() => reviewIntent(candidate, "reject")}>Reject</button>
            </div>}
          </>}
        </article>)}
      </div>}
      <details className="onboarding-add"><summary>Add an intent</summary><form className="onboarding-edit-form" onSubmit={addIntent}>
        <label>Intent name<input required value={newIntent.name} onChange={(event) => setNewIntent({ ...newIntent, name: event.target.value })} /></label>
        <label>Category<select value={newIntent.category} onChange={(event) => setNewIntent({ ...newIntent, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Description<textarea rows="2" value={newIntent.description} onChange={(event) => setNewIntent({ ...newIntent, description: event.target.value })} /></label>
        <label>Source / reason<input value={newIntent.source_reason} onChange={(event) => setNewIntent({ ...newIntent, source_reason: event.target.value })} /></label>
        <button disabled={!runId || busy === "intent-add"}>{busy === "intent-add" ? "Adding…" : "Add draft intent"}</button>
      </form></details>
    </Stage>

    <Stage number="5" title="Prompt Generation" status={promptRunId ? "complete" : "pending"}>
      <p className="sub">Only approved intents from this kickoff are passed into the existing Intent Mapper → Prompt Writer → Prompt QA pipeline.</p>
      <form className="row" onSubmit={generatePrompts}>
        <label>How many prompts<input type="number" min="5" max="100" value={total} onChange={(event) => setTotal(event.target.value)} /></label>
        <label className="grow">Focus (optional)<input value={focus} onChange={(event) => setFocus(event.target.value)} /></label>
        <button disabled={!activeRunId || !approvedIntents.length || visibleIntents.some((candidate) => candidate.status === "draft") || busy === "prompts"}>{busy === "prompts" ? "Generating…" : "Generate prompts"}</button>
      </form>
      {!approvedIntents.length && <p className="muted">Approve at least one intent before continuing.</p>}
      {visibleIntents.some((candidate) => candidate.status === "draft") && <p className="muted">Finish reviewing all draft intents before generating prompts.</p>}
    </Stage>

    <Stage number="6" title="Human Prompt Review" status={allPromptsReviewed ? "complete" : "pending"}>
      {!activePromptRunId ? <div className="empty">Generate prompts from approved intents to review candidates.</div> : <>
        <div className="meta"><Badge tone="good">{approvedPrompts.length} approved</Badge><Badge tone={pendingPrompts.length ? "warn" : "good"}>{pendingPrompts.length} draft</Badge><Badge tone="bad">{rejectedPrompts.length} rejected</Badge></div>
        <div className="onboarding-candidate-list">{visiblePrompts.map((prompt) => <article className="rec onboarding-candidate" key={prompt.id}>
          <div className="meta"><Badge>{prompt.intent}</Badge><Badge tone={statusTone(prompt.status)}>{prompt.status}</Badge>{prompt.prompt_type && <Badge>{prompt.prompt_type}</Badge>}</div>
          {promptEdit?.id === prompt.id ? <div className="onboarding-edit-form"><label>Prompt text<textarea rows="3" value={promptEdit.text} onChange={(event) => setPromptEdit({ ...promptEdit, text: event.target.value })} /></label><div className="actions"><button disabled={Boolean(busy)} onClick={() => reviewPrompt(prompt, "edit", promptEdit.text)}>Save edit</button><button className="secondary" onClick={() => setPromptEdit(null)}>Cancel</button></div></div> : <>
            <p>{prompt.prompt_text}</p><p className="muted">{prompt.rationale || prompt.persona || ""}</p>
            {prompt.status !== "rejected" && <div className="actions">
              <button className="secondary" onClick={() => setPromptEdit({ id: prompt.id, text: prompt.prompt_text })}>Edit</button>
              {prompt.status !== "approved" && <button disabled={Boolean(busy)} onClick={() => reviewPrompt(prompt, "approve")}>Approve</button>}
              <button className="secondary" disabled={Boolean(busy)} onClick={() => reviewPrompt(prompt, "reject")}>Reject</button>
            </div>}
          </>}
        </article>)}</div>
        <details className="onboarding-add"><summary>Add a prompt</summary><form className="onboarding-edit-form" onSubmit={addPrompt}>
          <label>Approved intent<select required value={newPrompt.intent_id || approvedIntents[0]?.approved_intent_id || ""} onChange={(event) => setNewPrompt({ ...newPrompt, intent_id: event.target.value })}>{approvedIntents.map((candidate) => <option key={candidate.approved_intent_id} value={candidate.approved_intent_id}>{candidate.name}</option>)}</select></label>
          <label>Prompt text<textarea required rows="3" value={newPrompt.prompt_text} onChange={(event) => setNewPrompt({ ...newPrompt, prompt_text: event.target.value })} /></label>
          <label>Type<select value={newPrompt.prompt_type} onChange={(event) => setNewPrompt({ ...newPrompt, prompt_type: event.target.value })}><option value="unbranded_discovery">Unbranded discovery</option><option value="occasion">Occasion</option><option value="comparison">Comparison</option><option value="local_context">Local context</option><option value="branded">Branded</option></select></label>
          <label>Rationale<input value={newPrompt.rationale} onChange={(event) => setNewPrompt({ ...newPrompt, rationale: event.target.value })} /></label>
          <button disabled={!activePromptRunId || busy === "prompt-add"}>{busy === "prompt-add" ? "Adding…" : "Add prompt candidate"}</button>
        </form></details>
        {finalReady && <Notice tone="ok"><strong>READY FOR TRACKING</strong><p>{approvedPrompts.length} approved prompts across {approvedIntents.length} approved intents are linked to {property?.name}.</p><a className="button" href={`/api/onboarding/prompt-runs/${encodeURIComponent(activePromptRunId)}/export.csv`} onClick={() => setMessage("Approved onboarding prompts exported for Rankscale.")}>Export approved prompts</a></Notice>}
      </>}
    </Stage>
  </div>;
}
