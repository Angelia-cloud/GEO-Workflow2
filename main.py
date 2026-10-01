from dotenv import load_dotenv
load_dotenv()
import os
import json
import re
import csv
from openai import OpenAI
from supabase import create_client, Client

# --- Setup ---
client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.environ["GROQ_API_KEY"],
)
supabase: Client = create_client(
    "https://ffkddjysalwssflbfueo.supabase.co",
    os.environ["SUPABASE_SECRET_KEY"]
)

MODEL = "openai/gpt-oss-120b"

IC_COOGEE_CLIENT_ID = "91aa6ea6-db1a-459b-9106-468d22e23024"


def call_agent(system_prompt, user_content):
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=2000,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    text = response.choices[0].message.content.strip()
    text = re.sub(r"^```json|```$", "", text).strip()
    return json.loads(text)


CLIENT_AGENT_PROMPT = """You are a GEO strategy analyst. Given a client brief, extract:
- brand_positioning (1-2 sentences)
- personas (list of target customer personas)
- key_attributes (list of key brand/product attributes)
- goals (list of business goals)
- missing_info (anything critical missing, e.g. no goals, no market info)

Respond ONLY with JSON:
{"brand_positioning": "...", "personas": [...], "key_attributes": [...],
 "goals": [...], "missing_info": [...]}"""


def process_client_brief(property_name, brief_text, client_id, is_competitor=False):
    result = call_agent(CLIENT_AGENT_PROMPT, brief_text)
    notes_payload = json.dumps(result)

    existing = (
        supabase.table("properties")
        .select("id")
        .eq("client_id", client_id)
        .eq("name", property_name)
        .execute()
    )

    record = {
        "name": property_name,
        "client_id": client_id,
        "is_competitor": is_competitor,
        "notes": notes_payload,
    }

    if existing.data:
        property_id = existing.data[0]["id"]
        supabase.table("properties").update(record).eq("id", property_id).execute()
    else:
        inserted = supabase.table("properties").insert(record).execute()
        property_id = inserted.data[0]["id"]

    return {"property_id": property_id, "extracted": result}


INTENT_AGENT_PROMPT = """You are a GEO strategy analyst. Given raw text (transcript, email,
or notes), extract distinct customer/search intents - short phrases describing what a
customer wants to know or do, expressed as something they'd type into an AI search engine.

Rules:
- Deduplicate any that mean the same thing
- Do not invent intents not supported by the text
- Assign each a short category (e.g. "pricing", "location", "amenities")

Respond ONLY with JSON:
{"intents": [{"name": "...", "category": "...", "description": "..."}]}"""


def extract_intents(property_id, raw_text):
    result = call_agent(INTENT_AGENT_PROMPT, raw_text)
    new_intents = result["intents"]

    existing = supabase.table("intents").select("name").eq("property_id", property_id).execute()
    existing_names = {row["name"].strip().lower() for row in existing.data}

    to_insert = [
        {
            "property_id": property_id,
            "name": i["name"],
            "category": i.get("category", ""),
            "description": i.get("description", ""),
        }
        for i in new_intents
        if i["name"].strip().lower() not in existing_names
    ]

    if to_insert:
        inserted = supabase.table("intents").insert(to_insert).execute()
        return inserted.data
    return []


PROMPT_AGENT_PROMPT = """You are a GEO strategy analyst. Given a list of customer intents,
generate realistic prompts a customer would type into an AI engine (ChatGPT, Claude, Gemini)
that would surface content related to that intent.

Rules:
- Generate 2-3 prompt variations per intent
- Every intent must be covered by at least one prompt
- Prompts should sound like natural user queries

Respond ONLY with JSON:
{"prompts": [{"intent_name": "...", "prompt_text": "..."}]}"""


def create_prompts(intents):
    intent_names = [i["name"] for i in intents]
    name_to_id = {i["name"]: i["id"] for i in intents}

    result = call_agent(PROMPT_AGENT_PROMPT, json.dumps({"intents": intent_names}))
    prompts = result["prompts"]

    covered = {p["intent_name"] for p in prompts}
    missing_coverage = [n for n in intent_names if n not in covered]

    to_insert = [
        {
            "intent_id": name_to_id[p["intent_name"]],
            "prompt_text": p["prompt_text"],
            "source": "agent_generated",
        }
        for p in prompts
        if p["intent_name"] in name_to_id
    ]

    if to_insert:
        supabase.table("prompts").insert(to_insert).execute()

    return {"prompts": to_insert, "missing_coverage": missing_coverage}


def export_prompts_to_csv(property_id, output_path="rankscale_import.csv"):
    intents = supabase.table("intents").select("id, name, category").eq("property_id", property_id).execute()
    intent_ids = [i["id"] for i in intents.data]
    intent_lookup = {i["id"]: i for i in intents.data}

    if not intent_ids:
        print("No intents found for this property.")
        return

    prompts = supabase.table("prompts").select("prompt_text, intent_id, source").in_("intent_id", intent_ids).execute()

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Topic", "SearchTerm", "Tags"])
        for p in prompts.data:
            intent = intent_lookup.get(p["intent_id"], {})
            category = intent.get("category", "General")
            writer.writerow([
                category,
                p["prompt_text"],
                category,
            ])

    print(f"Exported {len(prompts.data)} prompts to {output_path}")


# --- Entry point used by the API layer (replaces the old hardcoded __main__ block) ---
def run_pipeline(property_name, brief_text, raw_text, client_id, is_competitor=False):
    property_data = process_client_brief(property_name, brief_text, client_id, is_competitor)
    intents = extract_intents(property_data["property_id"], raw_text)

    if not intents:
        return {
            "property_id": property_data["property_id"],
            "extracted": property_data["extracted"],
            "intents_created": 0,
            "prompts_created": 0,
            "missing_coverage": [],
            "csv_path": None,
            "warning": "No new intents extracted from the notes provided",
        }

    prompt_result = create_prompts(intents)
    csv_path = f"/tmp/rankscale_import_{property_data['property_id']}.csv"
    export_prompts_to_csv(property_data["property_id"], csv_path)

    return {
        "property_id": property_data["property_id"],
        "extracted": property_data["extracted"],
        "intents_created": len(intents),
        "prompts_created": len(prompt_result["prompts"]),
        "missing_coverage": prompt_result["missing_coverage"],
        "csv_path": csv_path,
    }