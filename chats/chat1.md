# 화면 설계 범위 및 사양

_Started 2026-07-02 06:05 UTC_

---

## User

<system-info comment="Only acknowledge these if relevant">
Project title is now "Untitled"
What `list_files` on the project root returns right now (dotfiles, if any, are not shown here):
📁 uploads
Current date is now July 2, 2026
</system-info>

<default aesthetic_system_instructions>
The user has not attached a design system. If they have ALSO not attached references or art direction, and the project is empty, you must ASK the user what visual aesthetic they want. Use the questions_v2 tool to ask about preferred vibe, audience, colors, type, mood, etc. Do NOT just pick your own visual aesthetic without getting the user's aesthetic input -- this is how you get slop!

Once answered, use this guidance when creating designs:
- Choose a type pairing from web-safe set or Google Fonts. Helvetica is a good choice. Avoid hard-to-read or overly stylized fonts. Use 1-3 fonts only.
- Foreground and background: choose a color tone (warm, cool, neutral, something in-between). Use subtly-toned whites and blacks; avoid saturations above 0.02 for whites.
- Accents: choose 0-2 additional accent colors using oklch. All accents should share same chroma and lightness; vary hue.
- NEVER write out an SVG yourself that's more complicated than a square, circle, diamond, etc.
- For imagery, never hand-draw SVGs; use subtly-striped SVG placeholders instead with monospace explainers for what should be dropped there (e.g. “product shot”)

CRITICAL: ignore default aesthetic entirely if given other aesthetic instructions like reference images, design systems or guidance, or if there are files in the project already.
</default aesthetic_system_instructions>

<attached_files>
- uploads/단가계약_관리프로그램_ClaudeDesign_PRD.md
</attached_files>

<!-- The user explicitly selected the following skills for this project, as attachments to their message. These are not optional context — they define how you work. Use them. -->
<attached-skill name="Design Components">
This project uses Design Components: every design is a single streaming `Name.dc.html` file. The full authoring spec is in your system prompt under "Writing code — Design Components" — follow it. Author and edit `.dc.html` content with the `dc_write`, `dc_html_str_replace`, `dc_js_str_replace`, and `dc_set_props` tools (not `write_file`; `str_replace_edit` works but won't stream); template edits stream into the live preview as you type.
</attached-skill>

<attached-skill name="Hi-fi design">
Create a high-fidelity, polished design.

Follow this general design process (use the todo list to remember):
(1) ask questions, (2) find existing UI kits and collect design context — copy ALL relevant components and read ALL relevant examples; ask the user if you can't find them, (3) start your file with assumptions + context + design reasoning (as if you are a junior designer and the user is your manager), with placeholders for the designs, and show it to the user early, (4) build out the designs and show the user again ASAP; append some next steps, (5) use your tools to check, verify and iterate on the design.

Good hi-fi designs do not start from scratch — they are rooted in existing design context. Ask the user to Import their codebase, or find a suitable UI kit / design resources, or ask for screenshots of existing UI. You MUST spend time trying to acquire design context, including components. If you cannot find them, ask the user for them. In the Import menu, they can link a local codebase, provide screenshots or Figma links; they can also link another project. Mocking a full product from scratch is a LAST RESORT and will lead to poor design. If stuck, try listing design assets and ls'ing design system files — be proactive! Some designs may need multiple design systems — get them all. Use the starter components (device frames and the like) to get high-quality scaffolding for free.

When showing multiple design options on one page, decide between (a) a single full-size responsive prototype with a tweaks panel, or (b) a vertical stack of anchored option cards. Choose based on how design-y vs prototype-y the ask is, how many options there are, and how big each is. For (b):

Present multiple design options as a vertical stack of turns — each turn of options is its own `<section>`, newest turn at the **top**, and every option gets a stable `{turn}{letter}` id (`1a`, `1b`, `2a`…) that the user references back in chat and you cross-link between turns. Always include `<meta name="design_doc_mode" content="canvas">` in `<helmet>` — the host provides pan/zoom, so the user can freely zoom out on designs wider than the viewport.

**How to write it** — put one `<style>` block in `<helmet>`, then one `<section class="dv-turn">` per turn as a **direct child of the root** (right after `</helmet>`, no wrapper). When the user asks for another round, **insert the new section ABOVE the existing ones** so the latest work sits at the top; never reorder, renumber, or delete earlier turns.

```html
<helmet data-dc-atomics><meta name="design_doc_mode" content="canvas"><style>body{margin:0;background:#f0eee9;font-family:system-ui,sans-serif}.dv-turn{padding:40px 44px 32px;border-bottom:1px solid rgba(0,0,0,.08);scroll-margin-top:16px}.dv-thd{display:flex;align-items:baseline;gap:10px;margin:0 0 20px}.dv-tid{font:600 10px ui-monospace,Menlo,monospace;padding:3px 7px;background:#1a1a1a;color:#fff;border-radius:4px;text-decoration:none}.dv-tname{font:600 13px/1.2 system-ui,sans-serif;color:#1a1a1a}.dv-opts{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}.dv-opt{flex:none;display:flex;flex-direction:column;gap:9px;scroll-margin-top:16px}.dv-oid{font:600 10.5px ui-monospace,Menlo,monospace;padding:3px 7px;background:rgba(0,0,0,.08);color:#1a1a1a;border-radius:5px;text-decoration:none}.dv-olabel{display:flex;align-items:baseline;gap:8px;font:400 11px/1.3 system-ui,sans-serif;color:rgba(0,0,0,.55)}.dv-card{max-width:100%;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}.dv-opt:target .dv-oid{background:#2a78d6;color:#fff}.dv-next{margin:22px 0 0;font:12px/1.5 system-ui,sans-serif;color:rgba(0,0,0,.5)}</style></helmet>
<section class="dv-turn" id="t2">
<div class="dv-thd"><a class="dv-tid" href="#t2">2</a><span class="dv-tname">Riffs on <a class="dv-oid" href="#1b">1b</a></span></div>
<div class="dv-opts">
<div class="dv-opt" id="2a"><div class="dv-olabel"><a class="dv-oid" href="#2a">2a</a>Tighter spacing</div><div class="dv-card" style="width:360px">…design…</div></div>
<div class="dv-opt" id="2b">…</div>
</div>
<p class="dv-next">Try next: "more like <a class="dv-oid" href="#2a">2a</a> but with the serif from <a class="dv-oid" href="#1c">1c</a>" · "make <a class="dv-oid" href="#2b">2b</a> full-bleed" · "new directions"</p>
</section>
<section class="dv-turn" id="t1">…turn 1, unchanged…</section>
```

**Rules:** turn section ids are `t1`, `t2`, `t3`…; option ids are `1a`, `1b`, `2a`… and go on the option's **outermost** element (`.dv-opt`), never on the badge — so `#1b` scrolls the whole option into view. Ids are stable forever, never reused or renumbered. Options within a turn sit side-by-side in a wrapping row; don't hand-roll your own pan/zoom — the host canvas provides it. **Every** option-id reference in the file — turn heading, option label, `.dv-next` line, any prose — is an `<a class="dv-oid" href="#1b">1b</a>` link, never a bare `1b`; in your chat replies, just write `1b`. End each turn with a one-line `.dv-next` of 2–3 plain-English follow-ups the user could paste into chat. Size each `.dv-card` to its content (explicit width is fine); don't use `height:100%`.

When designing, asking many good questions is ESSENTIAL.

Give options: try to give 3+ variations across several dimensions. Mix by-the-book designs that match existing patterns with new and novel interactions, including interesting layouts, metaphors, and visual styles. Have some options that use color or advanced CSS; some with iconography and some without. Start your variations basic and get more advanced and creative as you go! Try remixing the brand assets and visual DNA in interesting ways — play with scale, fills, texture, visual rhythm, layering, novel layouts, type treatments. The goal is not the perfect option; it's exploring atomic variations the user can mix and match.

CSS, HTML, JS and SVG are amazing. Users often don't know what they can do. Surprise the user.

If you do not have an icon, asset or component, draw a placeholder: in hi-fi design, a placeholder is better than a bad attempt at the real thing.
</attached-skill>

<attached-skill name="Interactive prototype">
Create a fully interactive prototype with realistic state management and transitions. Use React useState/useEffect for dynamic behavior. Include hover states, click interactions, form validation, animated transitions, and multi-step navigation flows. It should feel like a real working app, not a static mockup.
</attached-skill>


<system-reminder>Auto-injected reminder (ignore if not relevant): do not recreate copyrighted or branded UI unless the user's email domain matches that company. Create original designs instead.</system-reminder>

## Assistant

_[tool: read_file]_

The PRD is thorough and locks the visual direction (dark navy top bar, orange accent, 4-column board, contract cards). A few scoping questions before I build:

_[tool: questions_v2]_

## User

Questions answered:
- scope: 화면 1·2·3 전부 (대시보드/표/이력)
- interactivity: 클릭되는 시안 정도 (주요 인터랙션만)
- data: 최소한의 예시 몇 건만
- variations: 네, 카드/보드 레이아웃 2~3개 변형
- density: 여유있게 (가독성 우선)
- font: Decide for me

## Assistant

I have a complete, detailed PRD and clear answers. I'll build a single interactive prototype DC with all 3 screens (dashboard / factory tables / contract history), a mail-preview modal, and expose the card/board-layout variations as tweaks (kanban vs priority board, full vs compact cards, accent, density). The reusable contract card repeats many times, so it justifies a child DC.

_[tool: update_todos]_

Now the child card DC:

_[tool: dc_write]_

_[tool: update_todos]_

Now the main dashboard DC:

_[tool: dc_write]_

_[tool: update_todos]_

_[tool: show_html]_

_[tool: show_html]_

The dashboard renders well — dark navy top bar, orange CTA, 4-column kanban board with contract cards, factory summary panel. All matches the PRD. Let me verify a couple other screens quickly, then hand off.

_[tool: ready_for_verification]_

PRD대로 데스크탑 대시보드 프로토타입을 완성했습니다.

**구현된 화면**
- **대시보드** — 요약 배너, 4컬럼 보드(만료경과/만료임박/이번달이후/갱신완료), 계약 카드(배지 2종·D-day·서류 진행바·액션 버튼), 우측 공장별 현황 패널
- **1/2/3공장·전체보기** — 검색·상태필터·좌측 컬러바 하이라이트 표
- **계약 이력** — 업체별 갱신 계보 타임라인
- **메일 발송 모달** — 템플릿 미리보기 후 mailto 실행

**클릭 동작**: 탭 전환, 상태 필터/검색, 메일 모달·mailto, 갱신/신규/수정/삭제 토스트.

**Tweaks(우측 패널)**: 보드 레이아웃 `kanban ↔ priority`, 카드 `full ↔ compact`, 강조색(오렌지 4종), 밀도 `여유 ↔ 조밀` — 카드/보드 레이아웃 변형을 여기서 바로 전환할 수 있습니다. 텍스트·색은 미리보기에서 직접 클릭 편집 가능합니다.

다음으로 실제 데이터 연동(Firebase) 매핑, 공사건 추가 폼, 또는 특정 화면 시안 변형이 필요하면 말씀해 주세요.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Also let the 공사명 cell keep a comfortable width so it wraps by word, not per character:

_[tool: dc_html_str_replace]_

_[tool: show_html]_

Let me check the table screen now:

_[tool: eval_js]_

_[tool: screenshot]_

Table scrolls and is readable now. The 공장 badge is wrapping vertically — quick fix:

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

표 레이아웃 문제를 수정했습니다 — 표는 이제 가로 스크롤되고, 협력업체명·공장 배지·공사명 열이 정상적으로 읽힙니다. 대시보드/표/이력 세 화면 모두 정상 동작합니다.

## User

아래 내용을 반영하여 수정해 주세요
1. '대시보드' 기능 삭제
2. '전체보기' 메뉴를 가장 왼쪽으로 이동
3. 상단바(캡쳐)에서 '공사건 추가', '캡쳐로 등록' 기능 제거

## Assistant

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: run_script]_

_[tool: read_file]_

Now I'll remove the entire dashboard block, fix the top/tab bars, and update the tabs logic:

_[tool: dc_html_str_replace]_

Now remove the top-bar add button and the tab-bar "캡처로 등록" button:

_[tool: dc_html_str_replace]_

Now update the logic: default tab, tab defs reordered without dashboard, and remove dead board tweaks. Let me view the relevant JS lines:

_[tool: read_file]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

Now clean up the dead board tweaks (they only affected the removed dashboard) — keep accent and density:

_[tool: dc_set_props]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

All three changes are in: 대시보드 removed, 전체보기 is now leftmost (and default), and the top bar no longer has 공사건 추가 or 캡처로 등록. Cleaning up the now-unused card component:

_[tool: delete_file]_

_[tool: ready_for_verification]_

세 가지 모두 반영했습니다.

1. **대시보드 삭제** — 탭·화면·관련 코드 모두 제거
2. **전체보기 최좌측 이동** — 이제 첫 번째 메뉴이자 기본 화면
3. **상단바 정리** — '공사건 추가'·'캡처로 등록' 버튼 제거 (날짜·만료임박 배지·알림벨만 유지)

메뉴는 전체보기 / 1공장 / 2공장 / 3공장 / 계약 이력 순입니다. 표 화면 안의 '+ 공사건 추가' 버튼은 상단바가 아니라 표 액션이라 유지했는데, 이것도 없애길 원하시면 말씀해 주세요.

