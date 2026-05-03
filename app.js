const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const paperArea = $("paperArea");
const titleCheckList = $("titleCheckList");

let allQuestions = [];
let generated = [];
let currentTitle = "";

const PAGE_SIZE = 5;

$("loadBtn").addEventListener("click", loadCsv);
$("makeBtn").addEventListener("click", makeQuiz);
$("printQuestionsBtn").addEventListener("click", () => savePdf("question"));
$("printAnswersBtn").addEventListener("click", () => savePdf("answer"));
$("csvFileInput").addEventListener("change", loadLocalCsv);
$("selectAllBtn").addEventListener("click", selectAllTitles);
$("clearAllBtn").addEventListener("click", clearAllTitles);
$("resetBtn").addEventListener("click", resetAll);

async function loadCsv() {
  try {
    const res = await fetch("./questions.csv?_=" + Date.now());
    if (!res.ok) throw new Error("questions.csv が見つかりません。");

    const text = await res.text();
    loadQuestionsFromText(text);
    statusEl.textContent = `${allQuestions.length}問を読み込みました。`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "読み込み失敗: " + err.message;
  }
}

async function loadLocalCsv(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    loadQuestionsFromText(text);
    statusEl.textContent = `${file.name} を読み込みました。${allQuestions.length}問あります。`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "ローカルCSVの読み込みに失敗しました。";
  }
}

function loadQuestionsFromText(text) {
  allQuestions = parseCsv(text).map(normalizeRow).filter(Boolean);
  renderTitleCheckList(allQuestions);

  generated = [];
  currentTitle = "";
  paperArea.className = "";
  paperArea.innerHTML = '<div class="empty-preview">まだ作成していません。</div>';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch === "\r") {
        // 何もしない
      } else {
        cell += ch;
      }
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (r[i] || "").trim();
      });
      return obj;
    })
    .filter((rowObj) => Object.values(rowObj).some((v) => v !== ""));
}

function normalizeRow(r) {
  const rawChoices = [];
  for (let n = 1; n <= 10; n++) {
    rawChoices.push((r[`choice${n}`] || "").trim());
  }

  const choices = rawChoices.filter((v) => v !== "");
  const answerNo = Number(r.answer_no);

  if (!r.question || choices.length < 3) return null;
  if (!(answerNo >= 1 && answerNo <= 10)) return null;
  if (!rawChoices[answerNo - 1]) return null;

  const correctText = rawChoices[answerNo - 1];
  const compactAnswerIndex = choices.indexOf(correctText);

  if (compactAnswerIndex === -1) return null;

  return {
    field_no: String(r.field_no || "").trim(),
    question_no: String(r.question_no || "").trim(),
    title_no: String(r.title_no || "").trim(),
    title: String(r.title || "").trim(),
    image: String(r.image || "").trim(),
    question: String(r.question || "").trim(),
    choices,
    answerIndex: compactAnswerIndex,
  };
}

function makeTitleKey(q) {
  return `${q.field_no}__${q.title_no}__${q.title}`;
}

function renderTitleCheckList(rows) {
  if (!rows.length) {
    titleCheckList.innerHTML = "表示できるタイトルがありません。";
    return;
  }

  const uniqueMap = new Map();

  rows.forEach((q) => {
    const key = makeTitleKey(q);
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        key,
        field_no: q.field_no,
        title_no: q.title_no,
        title: q.title,
      });
    }
  });

  const list = [...uniqueMap.values()].sort((a, b) =>
    a.key.localeCompare(b.key, "ja", { numeric: true })
  );

  titleCheckList.innerHTML = list
    .map(
      (item) => `
      <label class="check-item">
        <input type="checkbox" class="title-check" value="${escapeHtml(item.key)}" checked>
        <span>${escapeHtml(item.field_no)}：${escapeHtml(item.title)}（タイトル番号 ${escapeHtml(item.title_no)}）</span>
      </label>
    `
    )
    .join("");
}

function getSelectedTitleKeys() {
  return [...document.querySelectorAll(".title-check:checked")].map((el) => el.value);
}

function makeQuiz() {
  if (!allQuestions.length) {
    statusEl.textContent = "先にCSVを読み込んでください。";
    return;
  }

  const selectedTitleKeys = getSelectedTitleKeys();
  if (!selectedTitleKeys.length) {
    statusEl.textContent = "タイトルを1つ以上選んでください。";
    return;
  }

  const inputTitle = $("titleInput").value.trim();
  const count = Math.max(1, Number($("countInput").value || 5));

  const pool = allQuestions.filter((q) => selectedTitleKeys.includes(makeTitleKey(q)));

  if (pool.length < count) {
    statusEl.textContent = `対象問題が不足しています。現在 ${pool.length}問、必要 ${count}問です。`;
    return;
  }

  generated = shuffle([...pool])
    .slice(0, count)
    .map((q, i) => buildQuestion(q, i + 1));

  const uniqueTitles = [...new Set(generated.map((q) => q.title).filter(Boolean))];
  const csvTitle = uniqueTitles.join("・");
  currentTitle = inputTitle || csvTitle || "小テスト";

  renderPaper(currentTitle, generated, "answer");
  statusEl.textContent = `${currentTitle} を ${generated.length}問作成しました。`;
}

function buildQuestion(q, no) {
  const wrongIndexes = q.choices
    .map((_, i) => i)
    .filter((i) => i !== q.answerIndex);

  const pickedWrong = shuffle([...wrongIndexes]).slice(0, 2);
  const shownIndexes = shuffle([q.answerIndex, ...pickedWrong]);

  const shownChoices = shownIndexes.map((idx) => ({
    originalIndex: idx,
    text: q.choices[idx],
  }));

  const correctDisplayIndex = shownIndexes.indexOf(q.answerIndex);

  return {
    no,
    title_no: q.title_no,
    title: q.title,
    field_no: q.field_no,
    question_no: q.question_no,
    image: q.image,
    question: q.question,
    shownChoices,
    correctDisplayIndex,
    correctText: q.choices[q.answerIndex],
  };
}

function renderPaper(title, items, mode = "answer") {
  const labels = ["ア", "イ", "ウ"];
  const pages = [];

  for (let i = 0; i < items.length; i += PAGE_SIZE) {
    pages.push(items.slice(i, i + PAGE_SIZE));
  }

  paperArea.className = "preview-sheet multi-page";
  paperArea.innerHTML = pages
    .map((pageItems, pageIndex) => {
      if (pageIndex === 0) {
        return `
          <section class="pdf-page first-page">
            <h1 class="paper-title">${escapeHtml(title)}</h1>

            <div class="test-info single-line">
              <div>組：<span class="test-line class-line"></span></div>
              <div>番号：<span class="test-line no-line"></span></div>
              <div>氏名：<span class="test-line name-line"></span></div>
              <div>得点：<span class="score-box"></span> 点</div>
            </div>

            <div class="question-list">
              ${renderQuestions(pageItems, labels, mode)}
            </div>
          </section>
        `;
      }

      return `
        <section class="pdf-page">
          <h1 class="paper-title sub-title">${escapeHtml(title)}</h1>

          <div class="question-list">
            ${renderQuestions(pageItems, labels, mode)}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderQuestions(items, labels, mode) {
  return items
    .map(
      (item) => `
      <div class="question">
        <div class="answer-row">
          <div class="answer-box ${mode === "answer" ? "answer-box-filled answer-red" : ""}">
            ${mode === "answer" ? labels[item.correctDisplayIndex] : ""}
          </div>
          <div class="question-main">

            ${
              item.image
                ? `
              <div class="question-image-wrap">
                <img src="${escapeHtml(item.image)}" class="question-image" alt="問題画像">
              </div>
            `
                : ""
            }

            <div class="question-text">
              <strong>${item.no}.</strong>
              <span class="question-title-inline">${escapeHtml(item.title)}</span>
              ${escapeHtml(item.question)}
            </div>

            ${item.shownChoices
              .map(
                (c, i) => `
              <div class="choice">${labels[i]}　${escapeHtml(c.text)}</div>
            `
              )
              .join("")}
          </div>
        </div>
      </div>
    `
    )
    .join("");
}

async function savePdf(mode) {
  if (!generated.length) {
    statusEl.textContent = "先に問題を作成してください。";
    return;
  }

  renderPaper(currentTitle, generated, mode);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const filename =
    mode === "question"
      ? `${currentTitle}_問題.pdf`
      : `${currentTitle}_解答.pdf`;

  const opt = {
    margin: [0, 0, 0, 0],
    filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: 0,
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    },
    pagebreak: {
      mode: ["css"],
    },
  };

  try {
    await html2pdf().set(opt).from(paperArea).save();
    statusEl.textContent =
      mode === "question"
        ? "問題PDFを作成しました。"
        : "解答PDFを作成しました。";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "PDF作成に失敗しました。";
  } finally {
    renderPaper(currentTitle, generated, "answer");
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectAllTitles() {
  document.querySelectorAll(".title-check").forEach((el) => {
    el.checked = true;
  });
}

function clearAllTitles() {
  document.querySelectorAll(".title-check").forEach((el) => {
    el.checked = false;
  });
}

function resetAll() {
  if (!confirm("すべてのデータを初期化しますか？")) return;

  allQuestions = [];
  generated = [];
  currentTitle = "";

  $("titleInput").value = "";
  $("countInput").value = 5;
  $("csvFileInput").value = "";

  titleCheckList.innerHTML = "まだ読み込んでいません。";
  paperArea.className = "";
  paperArea.innerHTML = '<div class="empty-preview">まだ作成していません。</div>';

  statusEl.textContent = "初期化しました。";
}

loadCsv();
