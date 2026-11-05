"""Render explicit Work24 course requests from fetched records, never model prose."""
from __future__ import annotations

import re
from datetime import date
from urllib.parse import parse_qsl, urlsplit

_SKILLS = (
    (r"파이썬|python", "파이썬"), (r"데이터\s*(?:분석|과학)|빅데이터", "데이터"),
    (r"인공지능|머신러닝|딥러닝|\bAI\b", "인공지능"),
    (r"기계\s*설계|\bCAD\b", "기계설계"), (r"반도체", "반도체"),
    (r"웹\s*개발|프론트엔드|백엔드", "웹개발"),
    (r"자바(?:스크립트)?|\bjava(?:script)?\b", "자바"),
    (r"컴퓨터\s*공학|컴공|소프트웨어|프로그래밍", "소프트웨어"),
    (r"전기(?:전자)?(?:공학)?|전자공학|전자회로|(?<![가-힣A-Za-z])전자(?![가-힣])", "전기"), (r"회계", "회계"), (r"디자인", "디자인"),
    (r"품질\s*관리", "품질관리"), (r"생산\s*관리", "생산관리"), (r"용접", "용접"),
)


def plan_program_request(user_text, user_facts=None):
    """Return None for ordinary conversation, explanations, or unrelated advice."""
    text = str(user_text or "").strip()
    # "과정" may describe solving an assignment, and "프로그램" may mean code.
    # Those are ordinary tutoring requests, not invitations to search Work24.
    training_context = re.search(r"내일\s*배움|국비|훈련|교육|수강|강의|부트캠프|일학습\s*병행", text)
    career_context = re.search(r"취업|구직|진로|채용|면접|자소서|직무|사업주|컨소시엄", text)
    course_search = re.search(r"과정.{0,20}(?:추천|찾|검색|목록|신청|수강)|어떤.{0,20}과정", text)
    workflow = re.search(r"(?:해결|계산|분석|증명|처리|제작|작성|개발|설치|실행)\s*과정", text)
    software = re.search(r"프로그램.{0,20}(?:사용법|코드|소스|실행|설치|오류|버그)|(?:코드|소스).{0,15}프로그램", text)
    if not training_context and (workflow or software or not (career_context or course_search)):
        return None
    topic = re.search(r"내일\s*배움|국비|훈련|교육|강의|과정|프로그램|부트캠프|취업\s*역량|일학습\s*병행", text)
    request = re.search(r"추천|찾아|찾을|검색|알려|목록|어떤|뭐가|있어|있나|있을|신청.*(?:가능|할)|수강.*(?:가능|할)", text)
    definition = re.search(r"(?:뭐야|무엇|뜻|의미|설명|어떤\s*제도|발급|자격|지원\s*대상|사용법)", text)
    explicit_search = re.search(r"추천|찾아|검색|목록|과정.*알려|프로그램.*알려|어떤.*(?:과정|프로그램|교육)", text)
    if not topic or not request or (definition and not explicit_search):
        return None
    if re.search(r"추천\s*(?:하지\s*(?:마|말)|말고)|검색\s*(?:하지\s*(?:마|말)|말고)", text):
        return None
    kind = "national_card"
    if "사업주" in text:
        kind = "employer"
    elif "컨소시엄" in text:
        kind = "consortium"
    elif re.search(r"일학습\s*병행", text):
        kind = "work_study"
    jobseeker = bool(re.search(r"취업\s*역량|구직자.*프로그램|면접.*프로그램|자소서.*프로그램", text))
    training = bool(re.search(r"내일\s*배움|국비|훈련|교육|과정|부트캠프|일학습\s*병행", text)) or not jobseeker
    # Most recent stated skill wins; company names never become course names.
    candidates = [text] + list(reversed([v for v in (user_facts or []) if isinstance(v, str)]))
    keyword = ""
    for candidate in candidates:
        for pattern, value in _SKILLS:
            if re.search(pattern, candidate, re.I):
                keyword = value
                break
        if keyword:
            break
    return {"training": training, "jobseeker": jobseeker, "training_type": kind,
            "keyword": keyword, "region_code": "", "question": text}


def _key(value):
    return re.sub(r"[^a-z0-9가-힣]", "", str(value).lower())


def _url(value):
    if not isinstance(value, str):
        return ""
    value = value.strip().replace("&amp;", "&")
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            return ""
        if any(_key(k) in {"authkey", "apikey", "token", "accesstoken"} for k, _ in parse_qsl(parsed.query)):
            return ""
    except ValueError:
        return ""
    return value


def _dates(value):
    found = []
    for match in re.finditer(r"(?<!\d)(20\d{2})[.\-/년\s]*(\d{2}|\d)[.\-/월\s]*(\d{2}|\d)(?:일)?(?!\d)", value or ""):
        try:
            found.append(date(*map(int, match.groups())))
        except ValueError:
            pass
    return found


def program_records(data):
    """Keep raw public fields; do not fill missing dates, institutions or places."""
    aliases = {
        "title": {"trprnm", "traprocessnm", "trainingname", "programname", "progrmname", "prgmname", "pgmname", "pgmnm", "progrmnm", "coursename", "crsnm", "edunm", "trngnm", "title", "processnm", "subjectname", "훈련과정명", "과정명", "프로그램명"},
        "provider": {"subtitle", "instnm", "trprinstnm", "traininstnm", "institutionname", "provider", "기관명", "훈련기관명", "orgnm"},
        "location": {"trpraream", "areanm", "address", "address1", "regionname", "지역", "소재지", "openplccont"},
        "topic": {"pgmsubnm"},
        "target": {"pgmtarget", "traintarget"},
        "start": {"startdate", "trastartdate", "trprstartdate", "시작일", "pgmstdt"},
        "end": {"enddate", "traenddate", "trprenddate", "종료일", "pgmendt"},
        "period": {"period", "교육기간", "훈련기간"},
        "url": {"url", "titlelink", "detailurl", "detailpageurl", "trprurl", "viewurl", "link", "상세url", "상세주소"},
    }
    records = []
    def visit(node):
        if isinstance(node, dict):
            values = {_key(k): v for k, v in node.items()}
            record = {}
            for name, keys in aliases.items():
                record[name] = next((str(v).strip() for k, v in values.items() if k in keys and isinstance(v, (str, int, float)) and str(v).strip()), "")
            if record["title"]:
                record["url"] = _url(record["url"])
                records.append(record)
            else:
                for child in node.values():
                    visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
    visit(data)
    distinct = {}
    for record in records:
        identity = tuple(record[k] for k in ("title", "provider", "topic", "target", "start", "end", "period", "url"))
        distinct.setdefault(identity, record)
    return list(distinct.values())


def answer_program_request(plan, *, search_training, search_jobseeker_programs, today=None):
    """Call provided tools and return answer/tool_events/sources; no model call."""
    today = today or date.today()
    sections, events, sources = [], [], []
    calls = []
    if plan.get("training"):
        calls.append(("search_training", "고용24 훈련과정", search_training,
                      {"training_type": plan.get("training_type", "national_card"), "keyword": plan.get("keyword", ""), "region_code": "", "page_size": 10}))
    if plan.get("jobseeker"):
        calls.append(("search_jobseeker_programs", "구직자 취업역량 강화프로그램", search_jobseeker_programs, {"page_size": 10}))
    for name, label, callback, kwargs in calls:
        try:
            result = callback(**kwargs)
        except Exception:
            result = {"error": "lookup_failed"}
        if not isinstance(result, dict):
            result = {"error": "invalid_response"}
        error = bool(result.get("error"))
        events.append({"name": name, "ok": not error})
        lines = [label]
        if error:
            lines.append("현재 조회에 실패해 실제 과정과 일정을 확인하지 못했습니다. 잠시 후 다시 검색해 주세요.")
            sections.append("\n".join(lines))
            continue
        records = program_records(result.get("data"))
        available, expired = [], 0
        for record in records:
            ends = _dates(record["end"]) or _dates(record["period"])
            if ends and ends[-1] < today:
                expired += 1
            else:
                available.append(record)
        if not available:
            lines.append("조회한 결과에서 종료되지 않은 과정을 확인하지 못했습니다." if expired else "조회한 결과에 안내할 수 있는 과정명이 없습니다.")
        else:
            if name == "search_training":
                lines.append(("검색어: " + plan["keyword"] + ". ") if plan.get("keyword") else "분야가 정해지지 않아 먼저 조회된 과정을 보여드립니다. ")
                lines.append("전국 조회 결과이며 지역별 맞춤 순위는 아닙니다.")
            else:
                lines.append("특정 기업 전용 과정으로 확인된 것은 아닙니다.")
            for record in available[:3]:
                lines.append("- 과정명: " + record["title"])
                if record["topic"]:
                    lines.append("  세부 주제: " + record["topic"])
                if record["target"]:
                    lines.append("  대상: " + record["target"])
                lines.append("  기관: " + (record["provider"] or "응답에 없음"))
                lines.append(("  기관 소재지: " if name == "search_training" else "  장소: ") + (record["location"] or "응답에 없음"))
                if record["start"] or record["end"]:
                    period = (record["start"] or "시작일 미제공") + " ~ " + (record["end"] or "종료일 미제공")
                else:
                    period = record["period"] or "응답에 없음"
                lines.append("  일정: " + period)
                if record["url"]:
                    sources.append({"title": record["title"], "url": record["url"]})
            lines.append("일정이 남아 있어도 모집 중이라는 뜻은 아닙니다. 신청 가능 여부와 지원 대상·비용은 원문에서 확인해야 합니다.")
        if expired:
            lines.append(f"종료일이 지난 {expired}개 과정은 제외했습니다.")
        source = str(result.get("source") or "고용24 Open API")
        retrieved = str(result.get("retrieved_at") or today.isoformat())
        sources.append({"title": source + " · 조회일 " + retrieved, "url": ""})
        sections.append("\n".join(lines))
    if not plan.get("keyword") and plan.get("training"):
        sections.append("희망 직무나 배우고 싶은 기술을 알려주시면 그 키워드로 좁혀서 찾아드릴게요.")
    unique = []
    for source in sources:
        if source not in unique:
            unique.append(source)
    if unique:
        source_lines = ["출처"]
        for source in unique:
            source_lines.append("- " + source["title"])
            if source["url"]:
                source_lines.append(source["url"])
        if not any(source["url"] for source in unique):
            source_lines.append("응답에 과정별 원문 URL이 제공되지 않았습니다.")
        sections.append("\n".join(source_lines))
    return {"answer": "\n\n".join(sections), "tool_events": events, "sources": unique}
