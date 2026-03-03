const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const signForm = document.getElementById("signForm");
const signBtn = document.getElementById("signBtn");
const signedMessage = document.getElementById("signedMessage");
const signaturesList = document.getElementById("signaturesList");
const supportCount = document.getElementById("supportCount");
const opposeCount = document.getElementById("opposeCount");
const logoutBtn = document.getElementById("logoutBtn");
const uploadForm = document.getElementById("uploadForm");
const docFrame = document.getElementById("docFrame");

const emailStartForm = document.getElementById("emailStartForm");
const emailVerifyForm = document.getElementById("emailVerifyForm");
const emailInput = document.getElementById("emailInput");
const codeInput = document.getElementById("codeInput");
const emailHint = document.getElementById("emailHint");

const noticeDialog = document.getElementById("noticeDialog");
const noticeText = document.getElementById("noticeText");

let currentSession = null;
let pendingEmail = "";

function showNotice(text) {
  noticeText.textContent = text;
  if (typeof noticeDialog.showModal === "function") {
    noticeDialog.showModal();
  } else {
    alert(text);
  }
}

function fmtDate(value) {
  const d = new Date(value);
  return d.toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSignatures(payload) {
  supportCount.textContent = String(payload.summary.support || 0);
  opposeCount.textContent = String(payload.summary.oppose || 0);

  signaturesList.innerHTML = "";
  for (const item of payload.signatures) {
    const li = document.createElement("li");
    li.className = "signature-item";

    li.innerHTML = `
      <div class="signature-main">
        <div class="signature-name">${escapeHtml(item.organization)}</div>
        <span class="badge ${item.stance}">${item.stance === "support" ? "Підтримую" : "Не підтримую"}</span>
      </div>
      <div class="signature-meta">${fmtDate(item.createdAt)}</div>
    `;

    if (currentSession?.user?.isAdmin) {
      const row = document.createElement("div");
      row.className = "signature-admin";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Видалити";
      button.addEventListener("click", async () => {
        const ok = confirm(`Видалити підпис організації "${item.organization}"?`);
        if (!ok) return;
        const resp = await fetch(`/api/admin/signatures/${item.id}`, { method: "DELETE" });
        if (!resp.ok) {
          showNotice("Не вдалося видалити підпис.");
        }
      });
      row.appendChild(button);
      li.appendChild(row);
    }

    signaturesList.appendChild(li);
  }

  if (!payload.signatures.length) {
    const li = document.createElement("li");
    li.className = "signature-item";
    li.textContent = "Поки немає підписаних організацій.";
    signaturesList.appendChild(li);
  }
}

async function loadSignatures() {
  const resp = await fetch("/api/signatures");
  const data = await resp.json();
  renderSignatures(data);
}

function connectStream() {
  const source = new EventSource("/api/signatures/stream");
  source.addEventListener("signatures", (event) => {
    const payload = JSON.parse(event.data);
    renderSignatures(payload);
  });
}

function applySignedState() {
  if (!currentSession?.hasSigned) {
    signForm.classList.remove("hidden");
    signedMessage.classList.add("hidden");
    return;
  }

  signForm.classList.add("hidden");
  signedMessage.classList.remove("hidden");
  const stanceText =
    currentSession.signature.stance === "support" ? "Ви підтримали документ" : "Ви не підтримали документ";

  signedMessage.textContent = `${stanceText} від імені організації "${currentSession.signature.organization}". Повторне голосування з цього акаунта недоступне.`;
}

function renderSession() {
  const authenticated = Boolean(currentSession?.authenticated);
  authView.classList.toggle("hidden", authenticated);
  appView.classList.toggle("hidden", !authenticated);

  if (!authenticated) return;

  if (currentSession.user?.isAdmin) {
    uploadForm.classList.remove("hidden");
  } else {
    uploadForm.classList.add("hidden");
  }

  applySignedState();
}

async function loadSession() {
  const resp = await fetch("/api/session");
  currentSession = await resp.json();
  renderSession();
}

emailStartForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;

  const resp = await fetch("/api/auth/email/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  const data = await resp.json();
  if (!resp.ok) {
    showNotice("Невірний email або помилка сервера.");
    return;
  }

  pendingEmail = email;
  emailVerifyForm.classList.remove("hidden");
  emailHint.textContent = `Код підтвердження: ${data.code}. Для production надсилання має бути на email.`;
});

emailVerifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = codeInput.value.trim();

  const resp = await fetch("/api/auth/email/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: pendingEmail, code })
  });

  if (!resp.ok) {
    showNotice("Невірний або прострочений код.");
    return;
  }

  emailStartForm.reset();
  emailVerifyForm.reset();
  emailVerifyForm.classList.add("hidden");
  emailHint.textContent = "";
  pendingEmail = "";

  await loadSession();
  if (currentSession?.hasSigned) {
    showNotice("Ви вже підписали документ раніше. Повторне голосування недоступне.");
  }
});

signForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(signForm);
  const organization = String(formData.get("organization") || "").trim();
  const stance = String(formData.get("stance") || "support");

  if (!organization) {
    showNotice("Вкажіть назву організації.");
    return;
  }

  signBtn.disabled = true;
  try {
    const resp = await fetch("/api/signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization, stance })
    });

    if (resp.status === 409) {
      await loadSession();
      showNotice("Голосування з цього акаунта вже зафіксовано.");
      return;
    }

    if (!resp.ok) {
      showNotice("Не вдалося зафіксувати позицію. Перевірте дані та спробуйте ще раз.");
      return;
    }

    await loadSession();
    await loadSignatures();
    showNotice("Дякуємо за участь. Ваш голос зафіксовано.");
  } finally {
    signBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  const resp = await fetch("/api/logout", { method: "POST" });
  if (!resp.ok) {
    showNotice("Помилка виходу з акаунта.");
    return;
  }
  currentSession = null;
  renderSession();
  showNotice("Дякуємо за ознайомлення з документом.");
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("docUpload");
  const file = input.files?.[0];
  if (!file) {
    showNotice("Оберіть PDF-файл.");
    return;
  }

  const formData = new FormData();
  formData.append("document", file);

  const resp = await fetch("/api/admin/document", {
    method: "POST",
    body: formData
  });

  if (!resp.ok) {
    showNotice("Не вдалося завантажити документ. Перевірте права адміністратора.");
    return;
  }

  showNotice("Документ успішно оновлено.");
  docFrame.src = `/document.pdf?ts=${Date.now()}`;
  uploadForm.reset();
});

(async function init() {
  await loadSession();
  await loadSignatures();
  connectStream();

  if (currentSession?.hasSigned) {
    showNotice("Ви вже підписали документ раніше. Повторне голосування недоступне.");
  }
})();
