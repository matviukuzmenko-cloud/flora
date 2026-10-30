(() => {
  const diagnosisFile = document.querySelector("#garden-diagnosis-file");
  const diagnosisPreview = document.querySelector("#garden-diagnosis-preview");
  const diagnoseButton = document.querySelector("#garden-diagnose");
  const diagnosisStatus = document.querySelector("#garden-diagnosis-status");
  const diagnosisResult = document.querySelector("#garden-diagnosis-result");
  const diagnosisText = document.querySelector("#garden-diagnosis-text");
  const saveDiagnosisButton = document.querySelector("#garden-save-diagnosis");
  const journalForm = document.querySelector("#garden-journal-form");
  const journalPlant = document.querySelector("#garden-journal-plant");
  const journalDate = document.querySelector("#garden-journal-date");
  const journalNote = document.querySelector("#garden-journal-note");
  const journalPhoto = document.querySelector("#garden-journal-photo");
  const journalStatus = document.querySelector("#garden-journal-status");
  const journalList = document.querySelector("#garden-journal-list");
  const accountHint = document.querySelector("#garden-account-hint");
  const careForm = document.querySelector("#garden-care-form");
  const carePlant = document.querySelector("#garden-care-plant");
  const careInterval = document.querySelector("#garden-care-interval");
  const careStatus = document.querySelector("#garden-care-status");
  const careList = document.querySelector("#garden-care-list");
  const pushEnable = document.querySelector("#garden-push-enable");
  const pushDisable = document.querySelector("#garden-push-disable");
  const pushStatus = document.querySelector("#garden-push-status");
  if (!diagnosisFile || !journalForm || !careForm) return;

  const JOURNAL_KEY = "flora-garden-journal";
  const CARE_KEY = "flora-care-settings";
  const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  let selectedDiagnosisFile = null;
  let diagnosisObjectUrl = "";
  let latestDiagnosis = "";
  let accountUser = window.floraGetCurrentUser?.() || null;
  let client = window.floraGetSupabaseClient?.() || null;

  const dateToday = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const setStatus = (element, message, isError = false) => {
    element.textContent = message;
    element.dataset.state = isError ? "error" : "info";
  };
  const readArray = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== "object") return [];
      const deleted = new Set(Object.keys(value)
        .filter((id) => id.startsWith("__deleted:") && value[id] === true)
        .map((id) => id.slice("__deleted:".length)));
      return Object.entries(value)
        .filter(([id, entry]) => !id.startsWith("__deleted:") && !deleted.has(id) && entry && typeof entry === "object")
        .map(([, entry]) => entry);
    } catch (error) {
      console.error(`Не удалось прочитать данные ${key}.`, error);
      return [];
    }
  };
  const writeArray = (key, value) => {
    let previous = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      if (parsed && !Array.isArray(parsed) && typeof parsed === "object") previous = parsed;
    } catch (error) {
      console.error(`Не удалось объединить данные ${key}.`, error);
    }
    const records = Object.fromEntries(value
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => [entry.id, entry]));
    const next = Object.fromEntries(Object.entries(previous)
      .filter(([id]) => id.startsWith("__deleted:"))
      .slice(-500));
    Object.keys(previous).forEach((id) => {
      if (!id.startsWith("__deleted:") && !Object.hasOwn(records, id)) {
        next[`__deleted:${id}`] = true;
      }
    });
    Object.assign(next, records);
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("flora:local-data-change", {
      detail: { key, value: localStorage.getItem(key) },
    }));
  };
  const escapeText = (value) => String(value ?? "");
  const parseDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : null;
  const formatDate = (value) => {
    const date = parseDate(value);
    return date ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(date) : "Без даты";
  };
  const requestAccount = () => {
    document.querySelector("#account-open")?.click();
  };
  const fileToCompressedImage = async (file) => {
    if (!allowedTypes.has(file.type)) throw new TypeError("Поддерживаются только JPEG, PNG и WebP.");
    if (file.size > 12 * 1024 * 1024) throw new RangeError("Исходное фото должно быть меньше 12 МБ.");
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Браузер не смог подготовить изображение.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) reject(new Error("Не удалось обработать фото."));
          else resolve(result);
        }, "image/jpeg", 0.82);
      });
      if (blob.size > MAX_PHOTO_BYTES) throw new RangeError("После сжатия фото всё ещё больше 2 МБ.");
      return blob;
    } finally {
      bitmap.close();
    }
  };
  const blobToBase64 = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary);
  };
  const readSignedPhoto = async (path) => {
    if (!client || !path) return "";
    const { data, error } = await client.storage.from("flora-journal").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  };
  const renderJournal = async () => {
    journalList.replaceChildren();
    const dataOwner = localStorage.getItem("flora-data-owner");
    if (accountUser && dataOwner && dataOwner !== accountUser.id) {
      const loading = document.createElement("p");
      loading.className = "garden-empty";
      loading.textContent = "Загружаем дневник этого аккаунта…";
      journalList.append(loading);
      return;
    }
    const entries = readArray(JOURNAL_KEY)
      .filter((entry) => entry && typeof entry.id === "string")
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "garden-empty";
      empty.textContent = "Пока нет записей. Сохраните первое наблюдение за растением.";
      journalList.append(empty);
      return;
    }
    for (const entry of entries.slice(0, 100)) {
      const card = document.createElement("article");
      card.className = "garden-journal-entry";
      const heading = document.createElement("div");
      heading.className = "garden-entry-heading";
      const title = document.createElement("h3");
      title.textContent = escapeText(entry.plant);
      const date = document.createElement("time");
      date.dateTime = escapeText(entry.date);
      date.textContent = formatDate(entry.date);
      heading.append(title, date);
      card.append(heading);
      const note = document.createElement("p");
      note.textContent = escapeText(entry.note);
      card.append(note);
      if (typeof entry.photoPath === "string" && entry.photoPath) {
        try {
          const image = document.createElement("img");
          image.src = await readSignedPhoto(entry.photoPath);
          image.alt = `Фото растения: ${escapeText(entry.plant)}`;
          image.loading = "lazy";
          image.className = "garden-entry-photo";
          card.append(image);
        } catch (error) {
          console.error("Не удалось загрузить фото записи дневника.", error);
          const photoError = document.createElement("p");
          photoError.className = "garden-status";
          photoError.textContent = "Фото записи временно недоступно.";
          card.append(photoError);
        }
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button ghost small";
      remove.textContent = "Удалить запись";
      remove.addEventListener("click", () => { void deleteJournalEntry(entry); });
      card.append(remove);
      journalList.append(card);
    }
  };
  const renderCare = () => {
    careList.replaceChildren();
    const dataOwner = localStorage.getItem("flora-data-owner");
    if (accountUser && dataOwner && dataOwner !== accountUser.id) {
      const loading = document.createElement("p");
      loading.className = "garden-empty";
      loading.textContent = "Загружаем график ухода этого аккаунта…";
      careList.append(loading);
      return;
    }
    const plans = readArray(CARE_KEY)
      .filter((plan) => plan && typeof plan.id === "string" && typeof plan.name === "string");
    if (!plans.length) {
      const empty = document.createElement("p");
      empty.className = "garden-empty";
      empty.textContent = "Добавьте растение, чтобы настроить личные интервалы ухода.";
      careList.append(empty);
      return;
    }
    plans.forEach((plan) => {
      const card = document.createElement("article");
      card.className = "garden-care-item";
      const title = document.createElement("strong");
      title.textContent = escapeText(plan.name);
      const interval = document.createElement("span");
      interval.textContent = `Проверить через ${plan.intervalDays} дн.`;
      const lastWatered = document.createElement("small");
      lastWatered.textContent = plan.lastWatered ? `Последний полив: ${formatDate(plan.lastWatered)}` : "Полив пока не отмечен";
      const actions = document.createElement("div");
      actions.className = "garden-care-actions";
      const watered = document.createElement("button");
      watered.type = "button";
      watered.className = "button secondary small";
      watered.textContent = "Отметить полив";
      watered.addEventListener("click", () => {
        writeArray(CARE_KEY, plans.map((item) => item.id === plan.id ? { ...item, lastWatered: dateToday() } : item));
        renderCare();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button ghost small";
      remove.textContent = "Убрать";
      remove.addEventListener("click", () => {
        writeArray(CARE_KEY, plans.filter((item) => item.id !== plan.id));
        renderCare();
      });
      actions.append(watered, remove);
      card.append(title, interval, lastWatered, actions);
      careList.append(card);
    });
  };
  const updateAccountAccess = () => {
    accountHint.textContent = accountUser
      ? "Дневник и график ухода синхронизируются с аккаунтом. Фото хранятся в приватном облачном хранилище."
      : "Для облачной синхронизации дневника, фото и графика войдите в аккаунт Flora.";
    journalForm.querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = !accountUser; });
    careForm.querySelectorAll("input, button").forEach((control) => { control.disabled = !accountUser; });
    if (!accountUser) {
      pushEnable.disabled = true;
      pushDisable.hidden = true;
    } else {
      pushEnable.disabled = false;
    }
    void renderJournal();
    renderCare();
  };
  const deleteJournalEntry = async (entry) => {
    if (!accountUser || !client) return;
    try {
      if (entry.photoPath) {
        const { error } = await client.storage.from("flora-journal").remove([entry.photoPath]);
        if (error) throw error;
      }
      writeArray(JOURNAL_KEY, readArray(JOURNAL_KEY).filter((item) => item.id !== entry.id));
      setStatus(journalStatus, "Запись удалена.");
      await renderJournal();
    } catch (error) {
      console.error("Не удалось удалить запись дневника.", error);
      setStatus(journalStatus, `Не удалось удалить запись: ${error.message}`, true);
    }
  };

  journalDate.value = dateToday();
  updateAccountAccess();
  window.addEventListener("flora:account-state", (event) => {
    accountUser = event.detail?.user || null;
    client = event.detail?.client || window.floraGetSupabaseClient?.() || null;
    updateAccountAccess();
    void refreshPushState();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === JOURNAL_KEY) void renderJournal();
    if (event.key === CARE_KEY) renderCare();
  });
  window.addEventListener("flora:page-change", (event) => {
    if (event.detail?.page === "garden") {
      void renderJournal();
      renderCare();
      void refreshPushState();
    }
  });

  diagnosisFile.addEventListener("change", () => {
    selectedDiagnosisFile = diagnosisFile.files?.[0] || null;
    diagnosisResult.hidden = true;
    saveDiagnosisButton.hidden = true;
    latestDiagnosis = "";
    if (diagnosisObjectUrl) URL.revokeObjectURL(diagnosisObjectUrl);
    diagnosisObjectUrl = "";
    diagnoseButton.disabled = !selectedDiagnosisFile;
    if (selectedDiagnosisFile) {
      if (!allowedTypes.has(selectedDiagnosisFile.type)) {
        diagnoseButton.disabled = true;
        setStatus(diagnosisStatus, "Поддерживаются только JPEG, PNG и WebP.", true);
        return;
      }
      diagnosisObjectUrl = URL.createObjectURL(selectedDiagnosisFile);
      diagnosisPreview.src = diagnosisObjectUrl;
      diagnosisPreview.hidden = false;
      setStatus(diagnosisStatus, "Фото выбрано. Оно будет отправлено на анализ, но не сохранится автоматически.");
    } else {
      diagnosisPreview.removeAttribute("src");
      diagnosisPreview.hidden = true;
      setStatus(diagnosisStatus, "");
    }
  });
  diagnoseButton.addEventListener("click", async () => {
    if (!selectedDiagnosisFile || !window.FLORA_AI_ENDPOINT) {
      setStatus(diagnosisStatus, "Сервис диагностики пока не настроен.", true);
      return;
    }
    diagnoseButton.disabled = true;
    setStatus(diagnosisStatus, "Подготавливаем фото и анализируем его…");
    try {
      const image = await fileToCompressedImage(selectedDiagnosisFile);
      const response = await fetch(`${window.FLORA_AI_ENDPOINT}/api/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: { mimeType: image.type, data: await blobToBase64(image) } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Сервис вернул ошибку ${response.status}.`);
      if (result.stored !== false || typeof result.reply !== "string" || !result.reply.trim()) {
        throw new Error("Сервис вернул некорректный результат анализа.");
      }
      latestDiagnosis = result.reply.trim();
      diagnosisText.textContent = latestDiagnosis;
      diagnosisResult.hidden = false;
      saveDiagnosisButton.hidden = !accountUser;
      setStatus(diagnosisStatus, "Анализ завершён. Фото не было сохранено.");
    } catch (error) {
      console.error("Не удалось выполнить фото-анализ растения.", error);
      setStatus(diagnosisStatus, error.message || "Не удалось выполнить анализ.", true);
    } finally {
      diagnoseButton.disabled = !selectedDiagnosisFile;
    }
  });
  saveDiagnosisButton.addEventListener("click", () => {
    if (!accountUser || !latestDiagnosis) {
      requestAccount();
      return;
    }
    journalPlant.value = journalPlant.value || "Растение по фото";
    journalNote.value = latestDiagnosis;
    journalDate.value = dateToday();
    journalForm.scrollIntoView({ behavior: "smooth", block: "center" });
    journalPlant.focus();
  });
  journalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!accountUser || !client) {
      requestAccount();
      return;
    }
    const plant = journalPlant.value.trim();
    const note = journalNote.value.trim();
    const date = journalDate.value;
    const photo = journalPhoto.files?.[0];
    if (!plant || !note || !parseDate(date)) {
      setStatus(journalStatus, "Укажите растение, дату и описание наблюдения.", true);
      return;
    }
    const submit = document.querySelector("#garden-journal-submit");
    submit.disabled = true;
    setStatus(journalStatus, "Сохраняем запись…");
    let uploadedPath = "";
    try {
      const entryId = crypto.randomUUID();
      if (photo) {
        const compressed = await fileToCompressedImage(photo);
        uploadedPath = `${accountUser.id}/${entryId}.jpg`;
        const { error } = await client.storage.from("flora-journal").upload(uploadedPath, compressed, {
          contentType: compressed.type,
          upsert: false,
        });
        if (error) throw error;
      }
      const entries = readArray(JOURNAL_KEY);
      entries.push({ id: entryId, plant, date, note, photoPath: uploadedPath || undefined });
      const expired = entries.slice(0, Math.max(0, entries.length - 100));
      const expiredPhotos = expired.map((entry) => entry.photoPath).filter((path) => typeof path === "string" && path);
      writeArray(JOURNAL_KEY, entries.slice(-100));
      if (expiredPhotos.length) {
        const { error } = await client.storage.from("flora-journal").remove(expiredPhotos);
        if (error) {
          console.error("Не удалось удалить фотографии старых записей дневника.", error);
          setStatus(journalStatus, "Запись сохранена, но не удалось очистить фото старых записей.", true);
        }
      }
      journalForm.reset();
      journalDate.value = dateToday();
      if (!expiredPhotos.length) setStatus(journalStatus, "Запись сохранена в дневнике аккаунта.");
      await renderJournal();
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await client.storage.from("flora-journal").remove([uploadedPath]);
        if (cleanupError) console.error("Не удалось очистить фото после ошибки записи дневника.", cleanupError);
      }
      console.error("Не удалось сохранить запись дневника.", error);
      setStatus(journalStatus, `Не удалось сохранить запись: ${error.message}`, true);
    } finally {
      submit.disabled = false;
    }
  });
  careForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!accountUser) {
      requestAccount();
      return;
    }
    const name = carePlant.value.trim();
    const intervalDays = Number(careInterval.value);
    if (!name || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 90) {
      setStatus(careStatus, "Введите название растения и интервал от 1 до 90 дней.", true);
      return;
    }
    const plans = readArray(CARE_KEY);
    plans.push({ id: crypto.randomUUID(), name, intervalDays, lastWatered: dateToday() });
    writeArray(CARE_KEY, plans.slice(-100));
    careForm.reset();
    careInterval.value = "7";
    setStatus(careStatus, "Растение добавлено. Следующее напоминание придёт после указанного интервала.");
    renderCare();
  });

  const decodeBase64Url = (value) => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };
  const refreshPushState = async () => {
    if (!accountUser || !client || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      let linked = false;
      if (subscription) {
        const { data, error } = await client.from("push_subscriptions")
          .select("endpoint")
          .eq("user_id", accountUser.id)
          .eq("endpoint", subscription.endpoint)
          .maybeSingle();
        if (error) throw error;
        linked = Boolean(data);
      }
      pushDisable.hidden = !linked;
      pushEnable.hidden = linked;
      pushStatus.textContent = linked
        ? "Push-уведомления включены для этого аккаунта на устройстве."
        : "Push-уведомления для этого аккаунта выключены.";
    } catch (error) {
      console.error("Не удалось проверить настройки push-уведомлений.", error);
      setStatus(pushStatus, `Не удалось проверить уведомления: ${error.message}`, true);
    }
  };
  pushEnable.addEventListener("click", async () => {
    if (!accountUser || !client) {
      requestAccount();
      return;
    }
    const vapidPublicKey = window.FLORA_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setStatus(pushStatus, "Push пока не настроены владельцем сайта: отсутствует публичный VAPID-ключ.", true);
      return;
    }
    pushEnable.disabled = true;
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("Этот браузер не поддерживает push-уведомления.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Разрешите уведомления в настройках браузера.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(vapidPublicKey),
      });
      const json = subscription.toJSON();
      const keys = json.keys;
      if (!subscription.endpoint || !keys?.p256dh || !keys.auth) {
        await subscription.unsubscribe();
        throw new Error("Браузер не вернул данные push-подписки.");
      }
      const { error } = await client.from("push_subscriptions").upsert({
        endpoint: subscription.endpoint,
        user_id: accountUser.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,endpoint" });
      if (error) throw error;
      setStatus(pushStatus, "Уведомления включены. Напоминания будут приходить для записанных растений.");
      await refreshPushState();
    } catch (error) {
      console.error("Не удалось включить push-уведомления.", error);
      setStatus(pushStatus, error.message || "Не удалось включить уведомления.", true);
    } finally {
      pushEnable.disabled = false;
    }
  });
  pushDisable.addEventListener("click", async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && client) {
        const { error } = await client.from("push_subscriptions").delete()
          .eq("user_id", accountUser.id)
          .eq("endpoint", subscription.endpoint);
        if (error) throw error;
      }
      setStatus(pushStatus, "Напоминания отключены для этого аккаунта.");
      await refreshPushState();
    } catch (error) {
      console.error("Не удалось отключить push-уведомления.", error);
      setStatus(pushStatus, `Не удалось отключить уведомления: ${error.message}`, true);
    }
  });
})();
