let supabaseClient = null;

function installEmailMembership() {
  const box = document.getElementById("bhr-auth-box");
  const panel = document.getElementById("bhr-auth-panel");
  const headerTools = document.querySelector("header .header-tools");
  if (!box || !panel) return;
  const title = document.getElementById("bhrAuthTitle");
  const headerRow = box.querySelector(".bhr-up-row");
  if (!headerRow) return;
  Array.from(box.children).forEach((child) => { if (child !== headerRow) child.remove(); });

  const field = (id, labelText, type, autocomplete, placeholder) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;gap:4px";
    wrap.hidden = true;
    const label = document.createElement("label");
    label.className = "bhr-up-label";
    label.htmlFor = id;
    label.textContent = labelText;
    const input = document.createElement("input");
    input.className = "bhr-up-input";
    input.id = id;
    input.type = type;
    input.autocomplete = autocomplete;
    input.placeholder = placeholder || "";
    input.style.cssText = "width:100%;box-sizing:border-box";
    wrap.append(label, input);
    box.appendChild(wrap);
    return { wrap, input };
  };
  const nameField = field("bhrEmailAuthName", "نام و نام خانوادگی", "text", "name", "نام و نام خانوادگی");
  const emailField = field("bhrEmailAuthEmail", "ایمیل", "email", "email", "name@example.com");
  const passwordField = field("bhrEmailAuthPassword", "رمز عبور", "password", "current-password", "");
  const form = document.createElement("form");
  form.noValidate = true;
  form.style.cssText = "display:grid;gap:10px;margin-top:8px";
  form.append(nameField.wrap, emailField.wrap, passwordField.wrap);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "theme-btn";
  submit.style.cssText = "width:100%;justify-content:center";
  submit.textContent = "ورود";
  form.appendChild(submit);
  box.appendChild(form);

  const note = document.createElement("div");
  note.className = "bhr-warning";
  note.style.cssText = "margin-top:10px;font-size:12px;line-height:1.8";
  note.hidden = true;
  box.appendChild(note);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "theme-btn";
  reset.style.cssText = "display:block;margin:8px auto 0;font-size:12px";
  reset.textContent = "فراموشی رمز عبور";
  box.appendChild(reset);
  const switchMode = document.createElement("button");
  switchMode.type = "button";
  switchMode.className = "theme-btn";
  switchMode.style.cssText = "display:block;margin:5px auto 0;font-size:12px";
  box.appendChild(switchMode);
  const status = document.createElement("div");
  status.className = "bhr-up-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.cssText = "min-height:20px;margin-top:8px;line-height:1.8";
  box.appendChild(status);

  const signedIn = document.createElement("button");
  signedIn.type = "button";
  signedIn.className = "theme-btn bhr-auth-nav-button";
  signedIn.textContent = "حساب من";
  signedIn.hidden = true;
  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "theme-btn bhr-auth-nav-button";
  signOut.textContent = "خروج";
  signOut.hidden = true;
  if (headerTools) headerTools.append(signedIn, signOut);

  let mode = "login";
  let busy = false;
  const showPanel = (open) => {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  };
  const setMode = (nextMode) => {
    mode = nextMode;
    const recovery = mode === "recovery";
    const signup = mode === "signup";
    const resetMode = mode === "reset";
    title.textContent = signup ? "عضویت با ایمیل" : recovery ? "تغییر رمز عبور" : resetMode ? "بازیابی رمز عبور" : "ورود با ایمیل";
    nameField.wrap.hidden = !signup;
    nameField.input.disabled = !signup;
    nameField.input.required = signup;
    emailField.wrap.hidden = recovery;
    emailField.input.disabled = recovery;
    emailField.input.required = !recovery;
    passwordField.wrap.hidden = resetMode;
    passwordField.input.disabled = resetMode;
    passwordField.input.required = !resetMode;
    passwordField.input.minLength = signup || recovery ? 8 : 0;
    passwordField.input.autocomplete = signup || recovery ? "new-password" : "current-password";
    submit.textContent = signup ? "ساخت حساب" : recovery ? "ذخیره رمز جدید" : resetMode ? "ارسال لینک بازیابی" : "ورود";
    reset.hidden = mode !== "login";
    switchMode.hidden = recovery;
    switchMode.textContent = mode === "login" ? "حساب نداری؟ عضویت" : signup ? "حساب داری؟ ورود" : "بازگشت به ورود";
    note.hidden = !signup;
    note.textContent = "برای فعال‌شدن حساب، لینک تأییدی را که به ایمیلت فرستاده می‌شود باز کن.";
    status.textContent = "";
  };
  const updateAccountPanel = (session) => {
    const user = session && session.user;
    const accountPanel = document.getElementById("bhr-user-panel");
    if (!accountPanel) return;
    const badge = accountPanel.querySelector(".bhr-panel-status");
    const overview = accountPanel.querySelector('[data-bhr-panel-view="overview"] .bhr-panel-card p');
    const stats = accountPanel.querySelectorAll(".bhr-panel-stat strong");
    const profile = accountPanel.querySelector('[data-bhr-panel-view="profile"] .bhr-panel-empty');
    const settings = accountPanel.querySelector('[data-bhr-panel-view="settings"] .bhr-panel-empty');
    if (badge) badge.textContent = user ? "عضو · ورود با ایمیل" : "بدون ورود";
    if (overview) overview.textContent = user
      ? "ایمیل حساب در بخش پروفایل نمایش داده می‌شود. تاریخچه گفتگوها هنوز به حساب متصل نشده است."
      : "برای استفاده از حساب، با ایمیل وارد شو. تاریخچه گفتگوها هنوز به حساب متصل نشده است.";
    if (stats.length > 1) stats[1].textContent = user ? "فعال" : "مهمان";
    if (profile) profile.textContent = user
      ? "ایمیل حساب: " + (user.email || "ایمیل ثبت‌شده") + " · برای تغییر رمز از گزینه فراموشی رمز عبور استفاده کن."
      : "برای دیدن ایمیل حساب، ابتدا وارد شو یا عضویت را انجام بده.";
    if (settings) settings.textContent = "برای تغییر رمز عبور، از فرم ورود با ایمیل گزینه «فراموشی رمز عبور» را انتخاب کن.";
  };
  const applySession = (session) => {
    const user = session && session.user;
    document.querySelectorAll(".bhr-auth-nav-button").forEach((button) => {
      if (button === signedIn || button === signOut) return;
      button.hidden = !!user;
    });
    signedIn.hidden = !user;
    signOut.hidden = !user;
    updateAccountPanel(session);
  };

  document.querySelectorAll(".bhr-auth-nav-button").forEach((button) => {
    if (button === signedIn || button === signOut) return;
    button.addEventListener("click", () => setMode(button.getAttribute("aria-label") === "عضویت" ? "signup" : "login"));
  });
  reset.addEventListener("click", () => setMode("reset"));
  switchMode.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  signedIn.addEventListener("click", () => {
    const accountPanel = document.getElementById("bhr-user-panel");
    if (accountPanel) {
      accountPanel.classList.add("open");
      accountPanel.setAttribute("aria-hidden", "false");
    }
  });
  signOut.addEventListener("click", async () => {
    if (!supabaseClient) {
      status.textContent = "سرویس عضویت هنوز آماده نیست؛ صفحه را تازه کن و دوباره تلاش کن.";
      showPanel(true);
      return;
    }
    const result = await supabaseClient.auth.signOut();
    if (result.error) {
      status.textContent = "خروج انجام نشد. دوباره تلاش کن.";
      showPanel(true);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!supabaseClient) {
      status.textContent = "فرم آماده است، اما سرویس عضویت در دسترس نیست؛ کمی بعد دوباره تلاش کن.";
      return;
    }
    const email = emailField.input.value.trim();
    const password = passwordField.input.value;
    const name = nameField.input.value.trim();
    if (mode !== "recovery" && (!email || !emailField.input.checkValidity())) {
      status.textContent = "نشانی ایمیل معتبر وارد کن.";
      emailField.input.focus();
      return;
    }
    if (mode === "signup" && !name) {
      status.textContent = "نام و نام خانوادگی را وارد کن.";
      nameField.input.focus();
      return;
    }
    if ((mode === "signup" || mode === "recovery") && password.length < 8) {
      status.textContent = "رمز عبور باید حداقل ۸ نویسه باشد.";
      passwordField.input.focus();
      return;
    }
    if ((mode === "login" || mode === "signup" || mode === "recovery") && !password) {
      status.textContent = "رمز عبور را وارد کن.";
      passwordField.input.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    status.textContent = "در حال انجام…";
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      let result;
      if (mode === "signup") {
        result = await supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: redirectTo }
        });
        if (result.error) throw result.error;
        passwordField.input.value = "";
        if (result.data && result.data.session) {
          status.textContent = "حساب ساخته شد و وارد شدی.";
          applySession(result.data.session);
          window.setTimeout(() => showPanel(false), 700);
        } else {
          status.textContent = "درخواست عضویت ثبت شد. لینک تأیید را از ایمیلت باز کن، سپس وارد شو.";
        }
      } else if (mode === "login") {
        result = await supabaseClient.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        status.textContent = "با موفقیت وارد شدی.";
        passwordField.input.value = "";
        applySession(result.data && result.data.session);
        window.setTimeout(() => showPanel(false), 500);
      } else if (mode === "reset") {
        result = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (result.error) throw result.error;
        status.textContent = "اگر برای این ایمیل حسابی وجود داشته باشد، لینک بازیابی برایت فرستاده می‌شود.";
      } else {
        result = await supabaseClient.auth.updateUser({ password });
        if (result.error) throw result.error;
        passwordField.input.value = "";
        status.textContent = "رمز عبور با موفقیت تغییر کرد.";
        window.setTimeout(() => showPanel(false), 900);
      }
    } catch (error) {
      const message = String(error && error.message || "");
      const code = error && error.code || "";
      if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
        status.textContent = "ایمیل یا رمز عبور درست نیست.";
      } else if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
        status.textContent = "ابتدا لینک تأیید ارسال‌شده به ایمیلت را باز کن.";
      } else if (code === "weak_password" || /password.*(at least|characters)/i.test(message)) {
        status.textContent = "رمز عبور باید حداقل ۸ نویسه باشد.";
      } else if (error && error.status === 429) {
        status.textContent = "درخواست‌های زیادی انجام شده؛ چند دقیقه بعد دوباره تلاش کن.";
      } else {
        status.textContent = "انجام نشد. ایمیل و رمز عبور را بررسی کن و دوباره تلاش کن.";
      }
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });

  window.addEventListener("bhr:supabase-error", () => {
    status.textContent = "فرم عضویت آماده است، اما اتصال به سرویس ورود برقرار نشد.";
  });
  window.addEventListener("bhr:auth-state", (event) => {
    const detail = event.detail || {};
    applySession(detail.session || null);
    if (detail.event === "PASSWORD_RECOVERY") {
      setMode("recovery");
      status.textContent = "رمز عبور جدیدت را وارد کن.";
      showPanel(true);
    }
  });
  if (supabaseClient) {
    supabaseClient.auth.getSession().then((result) => {
      if (!result.error) applySession(result.data && result.data.session);
    }).catch(() => {});
  }
  setMode("login");
}

const SUPABASE_URL = "https://sbsalvbnozkmvmglhppr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fUXFAfepAtfg67_9ImF6Ow_DCHvA3qV";

window.BHR_SUPABASE = null;
window.BHR_SUPABASE_READY = false;
installEmailMembership();

import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) => {
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  window.BHR_SUPABASE = supabaseClient;
  window.BHR_SUPABASE_READY = true;
  window.dispatchEvent(new CustomEvent("bhr:supabase-ready"));
  supabaseClient.auth.onAuthStateChange((event, session) => {
    window.dispatchEvent(new CustomEvent("bhr:auth-state", {
      detail: { event, session }
    }));
  });
}).catch(() => {
  window.BHR_SUPABASE_READY = false;
  window.dispatchEvent(new CustomEvent("bhr:supabase-error"));
});
