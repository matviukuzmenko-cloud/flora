(() => {
  const accountOpen = document.querySelector("#account-open");
  const accountOpenLabel = document.querySelector("#account-open-label");
  const dialog = document.querySelector("#account-dialog");
  const closeButton = document.querySelector("#account-close");
  const guestPanel = document.querySelector("#account-guest");
  const userPanel = document.querySelector("#account-user");
  const form = document.querySelector("#account-form");
  const nicknameInput = document.querySelector("#account-nickname");
  const passwordInput = document.querySelector("#account-password");
  const submitButton = document.querySelector("#account-submit");
  const continueButton = document.querySelector("#account-continue");
  const status = document.querySelector("#account-status");
  const syncStatus = document.querySelector("#account-sync-status");
  const userNickname = document.querySelector("#account-user-nickname");
  const heroGreeting = document.querySelector("#hero-greeting");
  const signOutButton = document.querySelector("#account-signout");
  const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];
  if (!accountOpen || !accountOpenLabel || !dialog || !closeButton || !guestPanel || !userPanel || !form ||
      !nicknameInput || !passwordInput || !submitButton || !continueButton || !status || !syncStatus ||
      !heroGreeting || !userNickname || !signOutButton || modeButtons.length !== 2) {
    throw new Error("Не удалось инициализировать аккаунт Flora.");
  }

  const syncedKeys = new Set([
    "flora-favorites",
    "flora-collection",
    "flora-plant-notes",
    "flora-watering-dates",
    "flora-season-observations",
    "flora-garden-journal",
    "flora-care-settings",
    "flora-theme",
    "flora-palette",
    "flora-nickname",
  ]);
  const isSyncedKey = (key) => syncedKeys.has(key) ||
    key.startsWith("flora-ai-chat-history:") ||
    key.startsWith("flora-ai-chat-draft:") ||
    key.startsWith("flora-ai-chat-scroll:");
  const guestSessionKey = "flora-guest-session";
  const config = window.FLORA_SUPABASE_CONFIG;
  const configured = typeof config?.url === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url) &&
    typeof config.publishableKey === "string" && config.publishableKey.trim().length > 20;
  let supabaseClient = null;
  let currentUser = null;
  window.floraGetSupabaseClient = () => supabaseClient;
  window.floraGetCurrentUser = () => currentUser;
  let mode = "signup";
  let syncTimer = 0;
  let syncQueue = Promise.resolve();
  let hydration = null;
  const lastSyncedDataByUser = new Map();

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.dataset.state = isError ? "error" : "info";
  };
  const setSyncStatus = (message, isError = false) => {
    syncStatus.textContent = message;
    syncStatus.dataset.state = isError ? "error" : "info";
  };
  const normalizeNickname = (value) => value.normalize("NFKC").trim();
  const nicknameToEmail = async (nickname) => {
    const identityBytes = new TextEncoder().encode(normalizeNickname(nickname).toLocaleLowerCase("ru-RU"));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", identityBytes));
    const identity = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `flora-${identity}@login.flora-anotomy.invalid`;
  };

  const updateAccountView = () => {
    const authenticated = Boolean(currentUser);
    const nickname = currentUser?.user_metadata?.nickname || localStorage.getItem("flora-nickname") || "Садовод";
    guestPanel.hidden = authenticated;
    userPanel.hidden = !authenticated;
    accountOpen.setAttribute("aria-label", authenticated
      ? `Аккаунт Flora · ${currentUser.user_metadata?.nickname || "Профиль"}`
      : "Создать аккаунт или войти");
    accountOpen.title = authenticated
      ? `Аккаунт · ${currentUser.user_metadata?.nickname || "Профиль"}`
      : "Создать аккаунт или войти";
    accountOpenLabel.textContent = authenticated ? "Мой аккаунт" : "Создать аккаунт";
    if (authenticated) {
      userNickname.textContent = nickname;
      heroGreeting.textContent = `Рады видеть, ${nickname}!`;
    } else {
      heroGreeting.textContent = "Интерактивный ботанический атлас";
    }
    window.dispatchEvent(new CustomEvent("flora:account-state", {
      detail: { user: currentUser, client: supabaseClient },
    }));
  };

  const setMode = (nextMode) => {
    mode = nextMode;
    modeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.authMode === mode));
    });
    submitButton.textContent = mode === "signup" ? "Создать аккаунт" : "Войти";
    passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
    setStatus(configured ? "" : "Чтобы включить аккаунты, сначала создайте проект Supabase и добавьте его URL и публичный ключ в supabase-config.js.");
  };

  const readLocalData = () => {
    const data = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isSyncedKey(key)) {
        const value = localStorage.getItem(key);
        if (value !== null) data[key] = value;
      }
    }
    return data;
  };
  const getLocalSyncKeys = () => {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isSyncedKey(key)) keys.push(key);
    }
    return keys;
  };
  const applyLocalData = (data) => {
    let changed = false;
    const keys = new Set([...getLocalSyncKeys(), ...Object.keys(data)]);
    keys.forEach((key) => {
      if (!isSyncedKey(key)) return;
      const value = typeof data[key] === "string" ? data[key] : null;
      if (localStorage.getItem(key) === value) return;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      changed = true;
    });
    return changed;
  };

  const parseStored = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("Не удалось объединить повреждённые локальные данные с аккаунтом Flora.", error);
      return fallback;
    }
  };

  const mergeDataValue = (key, cloudValue, localValue) => {
    if (cloudValue === undefined) return localValue;
    if (localValue === undefined) return cloudValue;
    if (key === "flora-theme" || key === "flora-palette" || key === "flora-nickname") return cloudValue;

    const cloud = parseStored(cloudValue, null);
    const local = parseStored(localValue, null);
    if (key === "flora-favorites" || key === "flora-collection") {
      if (!Array.isArray(cloud) || !Array.isArray(local)) return localValue;
      return JSON.stringify([...new Set([...cloud, ...local].filter((id) => typeof id === "string"))]);
    }
    if (key === "flora-ai-chat-history" || key.startsWith("flora-ai-chat-history:")) {
      if (!Array.isArray(cloud) || !Array.isArray(local)) return localValue;
      const messages = [...cloud, ...local].filter((message) =>
        message && ["assistant", "user"].includes(message.role) && typeof message.content === "string"
      );
      let overlap = Math.min(cloud.length, local.length);
      while (overlap > 0) {
        const cloudTail = cloud.slice(-overlap);
        const localHead = local.slice(0, overlap);
        if (cloudTail.every((message, index) =>
          message?.role === localHead[index]?.role && message?.content === localHead[index]?.content
        )) break;
        overlap -= 1;
      }
      return JSON.stringify([...cloud, ...local.slice(overlap)].slice(-12));
    }
    if (!cloud || typeof cloud !== "object" || Array.isArray(cloud) ||
        !local || typeof local !== "object" || Array.isArray(local)) return localValue;

    if (key === "flora-season-observations") {
      const observations = { ...cloud };
      Object.entries(local).forEach(([plantId, periods]) => {
        if (Array.isArray(periods)) {
          observations[plantId] = [...new Set([
            ...(Array.isArray(observations[plantId]) ? observations[plantId] : []),
            ...periods,
          ])];
        }
      });
      return JSON.stringify(observations);
    }
    if (key === "flora-watering-dates") {
      const dates = { ...cloud };
      Object.entries(local).forEach(([plantId, date]) => {
        if (typeof date === "string" && (!dates[plantId] || date > dates[plantId])) dates[plantId] = date;
      });
      return JSON.stringify(dates);
    }
    return JSON.stringify({ ...cloud, ...local });
  };

  const valuesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const mergeSetChanges = (baseValue, localValue, cloudValue) => {
    if (!Array.isArray(baseValue) || !Array.isArray(localValue) || !Array.isArray(cloudValue)) return localValue;
    const base = new Set(baseValue.filter((value) => typeof value === "string"));
    const local = new Set(localValue.filter((value) => typeof value === "string"));
    const merged = new Set(cloudValue.filter((value) => typeof value === "string"));
    base.forEach((value) => {
      if (!local.has(value)) merged.delete(value);
    });
    local.forEach((value) => {
      if (!base.has(value)) merged.add(value);
    });
    return [...merged];
  };
  const mergeObjectChanges = (baseValue, localValue, cloudValue, mergeArrays = false) => {
    if (![baseValue, localValue, cloudValue].every((value) =>
      value && typeof value === "object" && !Array.isArray(value)
    )) return localValue;
    const merged = { ...cloudValue };
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(localValue)]);
    keys.forEach((key) => {
      const base = baseValue[key];
      const local = localValue[key];
      if (valuesEqual(base, local)) return;
      if (!Object.hasOwn(localValue, key)) {
        delete merged[key];
        return;
      }
      if (mergeArrays && Array.isArray(base) && Array.isArray(local) && Array.isArray(merged[key])) {
        merged[key] = mergeSetChanges(base, local, merged[key]);
      } else {
        merged[key] = local;
      }
    });
    return merged;
  };
  const mergeConcurrentData = (baseData, localData, cloudData) => {
    const merged = {};
    const keys = new Set([...Object.keys(baseData), ...Object.keys(localData), ...Object.keys(cloudData)]);
    keys.forEach((key) => {
      const base = baseData[key];
      const local = localData[key];
      const cloud = cloudData[key];
      if (valuesEqual(base, local)) {
        if (cloud !== undefined) merged[key] = cloud;
      } else if (key === "flora-favorites" || key === "flora-collection") {
        merged[key] = JSON.stringify(mergeSetChanges(
          parseStored(base, []),
          parseStored(local, []),
          parseStored(cloud, []),
        ));
      } else if (key === "flora-season-observations") {
        merged[key] = JSON.stringify(mergeObjectChanges(
          parseStored(base, {}),
          parseStored(local, {}),
          parseStored(cloud, {}),
          true,
        ));
      } else if (key === "flora-watering-dates") {
        const baseDates = parseStored(base, {});
        const localDates = parseStored(local, {});
        const cloudDates = parseStored(cloud, {});
        const dates = mergeObjectChanges(baseDates, localDates, cloudDates);
        Object.entries(localDates).forEach(([plantId, date]) => {
          if (date && cloudDates[plantId] && date < cloudDates[plantId]) {
            dates[plantId] = cloudDates[plantId];
          }
        });
        merged[key] = JSON.stringify(dates);
      } else if (key === "flora-garden-journal" || key === "flora-care-settings") {
        merged[key] = JSON.stringify(mergeObjectChanges(
          parseStored(base, {}),
          parseStored(local, {}),
          parseStored(cloud, {}),
        ));
      } else if (key === "flora-plant-notes") {
        merged[key] = JSON.stringify(mergeObjectChanges(
          parseStored(base, {}),
          parseStored(local, {}),
          parseStored(cloud, {}),
        ));
      } else if (local !== undefined) {
        merged[key] = local;
      }
    });
    return merged;
  };

  const saveCloudData = (userId, data, baseData = null) => {
    syncQueue = syncQueue.catch(() => undefined).then(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { data: row } = await window.floraWithRetry(() => supabaseClient
          .from("user_data")
          .select("data, version")
          .eq("user_id", userId)
          .maybeSingle(), { label: "Версия данных аккаунта" });
        const cloudData = row?.data && typeof row.data === "object" && !Array.isArray(row.data)
          ? row.data
          : {};
        const version = Number.isInteger(row?.version) ? row.version : 0;
        const nextData = baseData ? mergeConcurrentData(baseData, data, cloudData) : data;
        if (row && valuesEqual(nextData, cloudData)) {
          lastSyncedDataByUser.set(userId, cloudData);
          return cloudData;
        }
        const { data: result } = await window.floraWithRetry(() => supabaseClient.rpc("write_user_data", {
          p_data: nextData,
          p_expected_version: version,
        }), { label: "Синхронизация данных аккаунта" });
        const writeResult = Array.isArray(result) ? result[0] : result;
        if (writeResult && writeResult.has_conflict === false) {
          lastSyncedDataByUser.set(userId, writeResult.result_data);
          return writeResult.result_data;
        }
      }
      throw new Error("Данные меняются на другом устройстве. Повторите синхронизацию через несколько секунд.");
    });
    return syncQueue;
  };

  const syncCurrentData = (user) => {
    const localData = readLocalData();
    return saveCloudData(user.id, localData, lastSyncedDataByUser.get(user.id) || {});
  };
  const scheduleSync = (user) => {
    window.clearTimeout(syncTimer);
    if (!navigator.onLine) {
      setSyncStatus("Нет соединения. Изменения сохранены на устройстве и синхронизируются при подключении.");
      return;
    }
    setSyncStatus("Сохраняем изменения…");
    syncTimer = window.setTimeout(() => {
      if (currentUser?.id !== user.id) return;
      void syncCurrentData(user)
        .then(() => setSyncStatus("Все изменения сохранены."))
        .catch((error) => {
          console.error("Не удалось сохранить данные аккаунта Flora.", error);
          setSyncStatus(`Не удалось сохранить данные: ${error.message}`, true);
        });
    }, 700);
  };

  const hydrateAccount = async (user) => {
    if (hydration?.userId === user.id) return hydration.promise;
    const promise = (async () => {
      setSyncStatus("Синхронизируем ваши данные…");
      const { data: row } = await window.floraWithRetry(() => supabaseClient
        .from("user_data")
        .select("data, version")
        .eq("user_id", user.id)
        .maybeSingle(), { label: "Данные аккаунта" });

      const previousOwner = localStorage.getItem("flora-data-owner");
      const canImportLocalData = !previousOwner || previousOwner === user.id;
      const localData = canImportLocalData ? readLocalData() : {};
      if (!row) {
        const accountData = { ...localData };
        const accountNickname = user.user_metadata?.nickname;
        if (typeof accountNickname === "string" && accountNickname) accountData["flora-nickname"] = accountNickname;
        const savedData = await saveCloudData(user.id, accountData, {});
        lastSyncedDataByUser.set(user.id, savedData);
        const localChanged = applyLocalData(savedData);
        localStorage.setItem("flora-data-owner", user.id);
        if (localChanged) window.location.reload();
        setSyncStatus("Аккаунт готов. Данные этого устройства сохранены.");
        window.dispatchEvent(new CustomEvent("flora:account-state", {
          detail: { user: currentUser, client: supabaseClient },
        }));
        return;
      }
      if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) {
        throw new TypeError("В облаке найден некорректный формат данных аккаунта.");
      }

      let merged = {};
      const allKeys = new Set([...Object.keys(row.data), ...Object.keys(localData)]);
      allKeys.forEach((key) => {
        if (isSyncedKey(key)) merged[key] = mergeDataValue(key, row.data[key], localData[key]);
      });
      const accountNickname = user.user_metadata?.nickname;
      if (typeof accountNickname === "string" && accountNickname) merged["flora-nickname"] = accountNickname;

      const cloudChanged = JSON.stringify(merged) !== JSON.stringify(row.data);
      if (cloudChanged) {
        const savedData = await saveCloudData(user.id, merged, row.data);
        lastSyncedDataByUser.set(user.id, savedData);
        merged = savedData;
      } else {
        lastSyncedDataByUser.set(user.id, row.data);
      }
      const localChanged = applyLocalData(merged);
      localStorage.setItem("flora-data-owner", user.id);
      if (localChanged) {
        setSyncStatus("Данные объединены. Обновляем страницу…");
        window.location.reload();
        return;
      }
      setSyncStatus("Ваши данные синхронизированы.");
      window.dispatchEvent(new CustomEvent("flora:account-state", {
        detail: { user: currentUser, client: supabaseClient },
      }));
    })();
    hydration = { userId: user.id, promise };
    try {
      await promise;
    } finally {
      if (hydration?.userId === user.id) hydration = null;
    }
  };

  const initializeSupabase = async () => {
    if (!configured) {
      setStatus("Сначала подключите проект Supabase: добавьте Project URL и публичный ключ в supabase-config.js.");
      return;
    }
    try {
      const sdkUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      await window.floraWithRetry(() => new Promise((resolve, reject) => {
        const retryScript = document.createElement("script");
        retryScript.src = sdkUrl;
        retryScript.async = true;
        retryScript.addEventListener("load", resolve, { once: true });
        retryScript.addEventListener("error", () => {
          retryScript.remove();
          reject(new TypeError("Не удалось загрузить библиотеку Supabase."));
        }, { once: true });
        document.head.append(retryScript);
      }), { label: "Библиотека аккаунтов Supabase" });
      if (!window.supabase?.createClient) throw new Error("Библиотека Supabase загрузилась некорректно.");
      supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
      const { data } = await window.floraWithRetry(async () => {
        const result = await supabaseClient.auth.getSession();
        if (result.error) throw result.error;
        return result;
      }, { label: "Сессия аккаунта" });
      currentUser = data.session?.user || null;
      if (currentUser) sessionStorage.removeItem(guestSessionKey);
      updateAccountView();
      if (currentUser) void hydrateAccount(currentUser).catch((error) => {
        console.error("Не удалось синхронизировать данные аккаунта Flora.", error);
        setSyncStatus(`Не удалось синхронизировать данные: ${error.message}`, true);
      });
      supabaseClient.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        updateAccountView();
        if (event === "SIGNED_IN" && currentUser) {
          const nickname = currentUser.user_metadata?.nickname;
          if (typeof nickname === "string" && nickname) {
            localStorage.setItem("flora-nickname", nickname);
            window.dispatchEvent(new CustomEvent("flora:nickname-change", { detail: { nickname } }));
          }
          window.setTimeout(() => {
            if (currentUser) void hydrateAccount(currentUser).catch((error) => {
              console.error("Не удалось синхронизировать данные аккаунта Flora.", error);
              setSyncStatus(`Не удалось синхронизировать данные: ${error.message}`, true);
            });
          }, 0);
        }
      });
      setStatus("");
      if (!currentUser && sessionStorage.getItem(guestSessionKey) !== "continue") openAccount();
    } catch (error) {
      console.error("Не удалось подключить Supabase.", error);
      setStatus(`${error.message} Проверьте конфигурацию проекта и повторите попытку.`, true);
      if (sessionStorage.getItem(guestSessionKey) !== "continue") openAccount();
    }
  };

  const openAccount = () => {
    if (dialog.open) return;
    updateAccountView();
    dialog.showModal();
    if (!currentUser) nicknameInput.focus();
  };

  accountOpen.addEventListener("click", openAccount);
  closeButton.addEventListener("click", () => dialog.close());
  continueButton.addEventListener("click", () => {
    sessionStorage.setItem(guestSessionKey, "continue");
    dialog.close();
  });
  modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.authMode)));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!configured || !supabaseClient) {
      setMode(mode);
      return;
    }
    const nickname = normalizeNickname(nicknameInput.value);
    const password = passwordInput.value;
    if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(nickname)) {
      setStatus("Используйте 3–24 буквы, цифры, точку, дефис или подчёркивание.", true);
      return;
    }
    if (password.length < 8) {
      setStatus("Пароль должен содержать не менее 8 символов.", true);
      return;
    }
    submitButton.disabled = true;
    setStatus(mode === "signup" ? "Создаём аккаунт…" : "Входим в аккаунт…");
    try {
      const email = await nicknameToEmail(nickname);
      const result = await window.floraWithRetry(async () => {
        const authResult = mode === "signup"
          ? await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { nickname } },
          })
          : await supabaseClient.auth.signInWithPassword({ email, password });
        if (authResult.error) throw authResult.error;
        return authResult;
      }, { label: mode === "signup" ? "Регистрация" : "Вход в аккаунт" });
      if (!result.data.session) {
        setStatus("Supabase ожидает подтверждение email. Отключите Confirm email в Authentication → Providers → Email и попробуйте снова.", true);
        return;
      }
      currentUser = result.data.user;
      sessionStorage.removeItem(guestSessionKey);
      localStorage.setItem("flora-nickname", nickname);
      window.dispatchEvent(new CustomEvent("flora:nickname-change", { detail: { nickname } }));
      updateAccountView();
      setStatus("Аккаунт подключён. Сохраняем ваши данные…");
      setSyncStatus("Синхронизируем данные…");
      await hydrateAccount(currentUser);
    } catch (error) {
      console.error("Не удалось выполнить вход в аккаунт Flora.", error);
      const message = error.message?.includes("Invalid login credentials")
        ? "Ник или пароль не подошёл. Проверьте данные и попробуйте снова."
        : error.message?.includes("user_data")
          ? "Не найдена таблица user_data. Выполните SQL-файлы схемы и миграции из папки supabase в SQL Editor."
          : error.message?.includes("write_user_data")
            ? "Не применена миграция синхронизации. Выполните SQL-файл из папки supabase/migrations в SQL Editor."
            : `Не удалось выполнить запрос: ${error.message}`;
      setStatus(message, true);
    } finally {
      submitButton.disabled = false;
    }
  });
  signOutButton.addEventListener("click", async () => {
    if (!supabaseClient) return;
    signOutButton.disabled = true;
    setSyncStatus("Выходим из аккаунта…");
    try {
      window.clearTimeout(syncTimer);
      if (currentUser) await syncCurrentData(currentUser);
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      const signedOutUserId = currentUser?.id;
      currentUser = null;
      if (signedOutUserId) lastSyncedDataByUser.delete(signedOutUserId);
      updateAccountView();
      setStatus("Вы вышли. Данные браузера остались на этом устройстве.");
      setMode("signin");
    } catch (error) {
      console.error("Не удалось выйти из аккаунта Flora.", error);
      setSyncStatus(`Не удалось выйти из аккаунта: ${error.message}`, true);
    } finally {
      signOutButton.disabled = false;
    }
  });
  window.addEventListener("flora:local-data-change", (event) => {
    const key = event.detail?.key;
    if (!currentUser || !isSyncedKey(key)) return;
    scheduleSync(currentUser);
  });
  window.addEventListener("storage", (event) => {
    if (currentUser && event.key && isSyncedKey(event.key)) scheduleSync(currentUser);
  });
  window.addEventListener("offline", () => {
    if (currentUser) {
      window.clearTimeout(syncTimer);
      setSyncStatus("Нет соединения. Изменения сохранены на устройстве и синхронизируются при подключении.");
    }
  });
  window.addEventListener("online", () => {
    if (currentUser) scheduleSync(currentUser);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentUser) scheduleSync(currentUser);
  });

  setMode("signup");
  updateAccountView();
  void initializeSupabase();
})();
