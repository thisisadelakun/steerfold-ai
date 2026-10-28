import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// A small DOM fixture keeps every UI interaction local and every service mocked.
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.classList = { add: (name) => { this.className += ` ${name}`; } };
  }
  get isConnected() { return this.root === true || Boolean(this.parent?.isConnected); }
  get validity() {
    return { valid: (!this.required || Boolean(this.value)) &&
      (this.type !== "email" || /^[^\s@]+@[^\s@]+$/.test(this.value.trim())) };
  }
  get offsetHeight() { return 650; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) { if (force) this.setAttribute(name, ""); else this.removeAttribute(name); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector === "[data-auth-launcher]") return this.launcher === true;
    if (selector === 'input[type="email"]') return this.tag === "input" && this.type === "email";
    return this.tag === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector.split(",").some((part) => child.matches(part.trim())) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
  async fire(type, extra = {}) {
    if (type === "click" && this.disabled) return;
    const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const callback of this.listeners.get(type) || []) await callback(event);
  }
  focus() { this.owner.activeElement = this; }
  getBoundingClientRect() { return { left: 20, right: 80, top: 700 }; }
}

async function fixture({ immediate = false, signupError, signinError, signoutError, deferred = false, accountPage = false } = {}) {
  const document = new Element("document");
  document.root = true;
  document.createElement = (tag) => { const node = new Element(tag); node.owner = document; return node; };
  document.createElementNS = (_ns, tag) => document.createElement(tag);
  document.body = document.createElement("body");
  document.append(document.body);
  document.getElementById = (id) => document.querySelectorAll("div").find((node) => node.id === id) ?? null;
  const launcher = document.createElement("button");
  launcher.launcher = true;
  for (const className of ["sf-sidebar-account-label", "sf-button-icon"]) {
    const node = document.createElement("span"); node.className = className; launcher.append(node);
  }
  document.body.append(launcher);
  const window = new Element("window");
  window.innerWidth = 375;
  window.innerHeight = 600;
  let user = null;
  let profileName = "";
  let release;
  const gate = deferred ? new Promise((resolve) => { release = resolve; }) : null;
  const calls = { signup: [], signin: [], signout: 0, changed: 0, account: 0 };
  window.addEventListener("auth:changed", () => { calls.changed++; });
  const services = {
    "./auth-service.js": {
      getCurrentUser: () => user,
      isAuthenticated: () => Boolean(user),
      signUp: async (...args) => {
        calls.signup.push(args);
        if (gate) await gate;
        if (signupError) throw signupError;
        if (immediate) user = { id: "new-user", email: args[0] };
        return { user: { id: "new-user" }, session: immediate ? { access_token: "mock-token", user } : null,
          needsEmailVerification: !immediate };
      },
      signIn: async (...args) => {
        calls.signin.push(args);
        if (signinError) throw signinError;
        user = { id: "existing-user", email: args[0] };
      },
      signOut: async () => { calls.signout++; user = null; if (signoutError) throw signoutError; },
    },
    "./profile-identity.js": {
      profileDisplayName: () => profileName.split(" ")[0] || "Account",
      profileInitials: () => profileName ? profileName.split(" ").map((part) => part[0]).join("") : "?",
    },
  };
  const context = vm.createContext({ document, window, CustomEvent: class {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  } });
  const module = new vm.SourceTextModule(await readFile(new URL("../app/js/auth-ui.js", import.meta.url), "utf8"), { context });
  const cache = new Map();
  await module.link((specifier) => {
    assert.ok(services[specifier], `Unexpected dependency ${specifier}`);
    if (!cache.has(specifier)) {
      const exports = services[specifier];
      cache.set(specifier, new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context }));
    }
    return cache.get(specifier);
  });
  await module.evaluate();
  const init = () => module.namespace.initAuthUI(accountPage ? { onOpenAccount() { calls.account++; } } : {});
  init();
  const panel = document.getElementById("sf-auth-panel");
  const f = { document, window, launcher, panel, calls, release, init,
    field: (name) => panel.querySelectorAll("input").find((node) => node.name === name),
    button: (text) => panel.querySelectorAll("button").find((node) => node.textContent === text),
    form: () => panel.querySelector("form"),
    error: () => panel.querySelector(".sf-auth-error"),
    title: () => panel.querySelector("h2").textContent,
    setProfile(name) { profileName = name; window.dispatchEvent({ type: "profile:identity-changed" }); },
    async signup() { await launcher.fire("click"); await f.button("Sign Up").fire("click"); },
    fill(values = {}) {
      const defaults = { fullName: " Taylor Shah ", email: " taylor@example.invalid ", password: " synthetic-password ", confirmPassword: " synthetic-password " };
      for (const [key, value] of Object.entries({ ...defaults, ...values })) f.field(key).value = value;
    },
  };
  return f;
}

test("signup uses existing labeled controls, autocomplete, focus, and independent password toggles", async () => {
  const f = await fixture();
  await f.signup();
  assert.equal(f.title(), "Sign Up");
  assert.deepEqual(f.panel.querySelectorAll("label").map((node) => node.textContent), ["Full Name", "Email Address", "Password", "Confirm Password"]);
  assert.equal(f.document.activeElement, f.field("fullName"));
  for (const input of f.panel.querySelectorAll("input")) {
    assert.equal(input.required, true);
    assert.ok(f.panel.querySelectorAll("label").some((label) => label.htmlFor === input.id));
  }
  assert.equal(f.field("fullName").autocomplete, "name");
  assert.equal(f.field("fullName").maxLength, 120);
  assert.equal(f.field("email").autocomplete, "username");
  const toggles = f.panel.querySelectorAll(".sf-auth-password-toggle");
  assert.equal(toggles.length, 2);
  for (const [index, name] of ["password", "confirmPassword"].entries()) {
    assert.equal(f.field(name).autocomplete, "new-password");
    assert.equal(toggles[index].type, "button");
    await toggles[index].fire("click");
    assert.equal(f.field(name).type, "text");
    assert.equal(toggles[index].getAttribute("aria-label"), "Hide password");
    assert.equal(toggles[index].title, "Hide password");
    await toggles[index].fire("click");
    assert.equal(f.field(name).type, "password");
    assert.equal(toggles[index].getAttribute("aria-label"), "Show password");
  }
  assert.equal(f.panel.style.maxHeight, "calc(100vh - 24px)");
  assert.equal(f.panel.style.overflowY, "auto");
});

for (const [values, message, focus] of [
  [{ fullName: " \t " }, /full name/, "fullName"],
  [{ fullName: "X".repeat(121) }, /120/, "fullName"],
  [{ email: " " }, /email address/, "email"],
  [{ email: "bad-email" }, /email address/, "email"],
  [{ password: "", confirmPassword: "" }, /password/, "password"],
  [{ confirmPassword: "" }, /must match/, "confirmPassword"],
  [{ confirmPassword: "synthetic-password" }, /must match/, "confirmPassword"],
]) {
  test(`invalid signup ${JSON.stringify(values)} is rejected before calling the service`, async () => {
    const f = await fixture(); await f.signup(); f.fill(values);
    await f.form().fire("submit");
    assert.equal(f.calls.signup.length, 0);
    assert.equal(f.calls.changed, 0);
    assert.match(f.error().textContent, message);
    assert.equal(f.error().hidden, false);
    assert.equal(f.error().getAttribute("role"), "alert");
    assert.equal(f.document.activeElement, f.field(focus));
    assert.equal(f.button("Sign Up").disabled, false);
  });
}

test("pending verification passes fullName to metadata-capable service, never authenticates, and returns to sign in", async () => {
  const f = await fixture(); await f.signup(); f.fill();
  const password = f.field("password");
  const confirm = f.field("confirmPassword");
  await f.form().fire("submit");
  assert.deepEqual(f.calls.signup, [["taylor@example.invalid", " synthetic-password ", "Taylor Shah"]]);
  assert.equal(f.calls.changed, 0);
  assert.equal(f.calls.signin.length, 0);
  assert.equal(f.title(), "Check Your Email");
  assert.equal(password.value, ""); assert.equal(confirm.value, "");
  assert.equal(f.form(), null);
  const status = f.panel.querySelector(".sf-auth-verification");
  assert.equal(status.getAttribute("role"), "status");
  assert.match(status.textContent, /taylor@example.invalid/);
  assert.match(status.textContent, /not signed in yet/);
  assert.equal(f.launcher.querySelector(".sf-sidebar-account-label").textContent, "Sign In");
  await f.button("Return to Sign In").fire("click");
  assert.equal(f.title(), "Sign In");
  assert.equal(f.field("email").value, "taylor@example.invalid");
  assert.equal(f.field("password").value, "");
  assert.equal(f.document.activeElement, f.field("email"));
  f.field("password").value = "verified-password";
  await f.form().fire("submit");
  assert.equal(f.calls.signin.length, 1);
  assert.equal(f.calls.changed, 1);
});

test("only a real signup session emits auth change and profile identity remains authoritative", async () => {
  const f = await fixture({ immediate: true }); await f.signup(); f.fill();
  await f.form().fire("submit");
  assert.equal(f.calls.changed, 1);
  assert.equal(f.title(), "Account");
  assert.equal(f.panel.querySelector(".sf-account-avatar").textContent, "?");
  f.setProfile("Abayomi Adelakun");
  assert.equal(f.title(), "Abayomi");
  assert.equal(f.panel.querySelector(".sf-account-avatar").textContent, "AA");
  assert.equal(f.launcher.querySelector(".sf-sidebar-account-label").textContent, "Abayomi");
  assert.equal(f.launcher.querySelector(".sf-account-avatar").textContent, "AA");
});

test("authenticated signup follows existing account-page callback behavior", async () => {
  const f = await fixture({ immediate: true, accountPage: true }); await f.signup(); f.fill();
  await f.form().fire("submit");
  assert.equal(f.panel.hidden, true);
  assert.equal(f.calls.account, 0);
  await f.launcher.fire("click");
  assert.equal(f.calls.account, 1);
});

test("signup locks submit and mode switch, prevents duplicate requests, and can finish while closed", async () => {
  const f = await fixture({ deferred: true }); await f.signup(); f.fill();
  const form = f.form();
  const submit = f.button("Sign Up");
  const back = f.button("Return to Sign In");
  const pending = form.fire("submit");
  assert.equal(submit.disabled, true); assert.equal(back.disabled, true);
  await form.fire("submit"); await back.fire("click");
  assert.equal(f.calls.signup.length, 1);
  assert.equal(f.title(), "Sign Up");
  await f.document.fire("keydown", { key: "Escape" });
  assert.equal(f.panel.hidden, true);
  assert.equal(f.document.activeElement, f.launcher);
  f.release(); await pending;
  assert.equal(f.panel.hidden, true);
  assert.equal(f.document.activeElement, f.launcher);
  assert.equal(f.calls.changed, 0);
});

for (const signupError of [new Error("Signup unavailable"), {}]) {
  test(`signup failure displays ${signupError.message || "fallback"} and allows retry and return`, async () => {
    const f = await fixture({ signupError }); await f.signup(); f.fill();
    await f.form().fire("submit");
    assert.equal(f.title(), "Sign Up");
    assert.equal(f.error().textContent, signupError.message || "Sign up failed.");
    assert.equal(f.error().hidden, false);
    assert.equal(f.button("Sign Up").disabled, false);
    assert.equal(f.button("Return to Sign In").disabled, false);
    assert.equal(f.calls.changed, 0);
    await f.form().fire("submit"); assert.equal(f.calls.signup.length, 2);
    await f.button("Return to Sign In").fire("click");
    assert.equal(f.title(), "Sign In");
    assert.equal(f.field("password").autocomplete, "current-password");
    assert.equal(f.field("password").value, "");
  });
}

for (const signoutError of [undefined, new Error("Remote logout unavailable")]) {
  test(`existing sign in and ${signoutError ? "failed remote" : "successful"} sign out remain functional`, async () => {
    const f = await fixture({ signoutError }); f.init();
    await f.launcher.fire("click");
    f.field("email").value = " existing@example.invalid ";
    f.field("password").value = " exact password ";
    await f.form().fire("submit");
    assert.deepEqual(f.calls.signin, [["existing@example.invalid", " exact password "]]);
    assert.equal(f.calls.changed, 1);
    assert.equal(f.calls.signup.length, 0);
    await f.button("Sign Out").fire("click");
    assert.equal(f.calls.signout, 1);
    assert.equal(f.calls.changed, 2);
    assert.equal(f.title(), "Sign In");
    if (signoutError) assert.match(f.error().textContent, /Signed out locally/);
    assert.ok(f.button("Sign Up"));
  });
}

test("switching auth views stops the removed button's click from closing the panel", async () => {
  const f = await fixture();
  await f.launcher.fire("click");
  for (const title of ["Sign Up", "Return to Sign In"]) {
    const target = f.button(title);
    let stopped = false;
    await target.fire("click", { stopPropagation() { stopped = true; } });
    if (!stopped) f.document.dispatchEvent({ type: "click", target });
    assert.equal(stopped, true);
    assert.equal(f.panel.hidden, false);
  }
});

test("existing sign-in errors remain visible and signup is still reachable", async () => {
  const f = await fixture({ signinError: new Error("Invalid credentials") });
  await f.launcher.fire("click");
  f.field("email").value = "existing@example.invalid";
  f.field("password").value = "incorrect-password";
  await f.form().fire("submit");
  assert.equal(f.error().textContent, "Invalid credentials");
  assert.equal(f.button("Sign In").disabled, false);
  await f.button("Sign Up").fire("click");
  assert.equal(f.title(), "Sign Up");
  assert.equal(f.error().hidden, true);
});
