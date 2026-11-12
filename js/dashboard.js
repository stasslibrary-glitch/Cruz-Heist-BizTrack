
/* =========================================================
   CRUZ HEIST GRAPHICS LAB — LIVE DASHBOARD
   Firebase Authentication + Cloud Firestore
   UGX / USD Currency Switching
   ========================================================= */

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ---------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------

const EXCHANGE_RATE = 4288.44;
const DEFAULT_CURRENCY = "UGX";

let displayCurrency = localStorage.getItem("ch_display_currency") || DEFAULT_CURRENCY;

// ---------------------------------------------------------
// DOM HELPERS
// ---------------------------------------------------------

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

// ---------------------------------------------------------
// CURRENCY SYSTEM
// ---------------------------------------------------------

function formatMoney(value) {
  const amount = Number(value) || 0;

  if (displayCurrency === "USD") {
    return "USD " + new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount / EXCHANGE_RATE);
  }

  return "UGX " + new Intl.NumberFormat("en-UG", {
    maximumFractionDigits: 0
  }).format(amount);
}

function updateCurrencyButtons() {
  const ugx = $("#currencyUGX");
  const usd = $("#currencyUSD");

  if (ugx) {
    ugx.classList.toggle("active", displayCurrency === "UGX");
    ugx.setAttribute("aria-pressed", String(displayCurrency === "UGX"));
  }

  if (usd) {
    usd.classList.toggle("active", displayCurrency === "USD");
    usd.setAttribute("aria-pressed", String(displayCurrency === "USD"));
  }

  setText(
    "#exchangeRate",
    `1 USD = UGX ${new Intl.NumberFormat("en-UG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(EXCHANGE_RATE)}`
  );
}

function changeCurrency(currency) {
  if (!["UGX", "USD"].includes(currency)) return;

  displayCurrency = currency;

  localStorage.setItem("ch_display_currency", currency);

  updateCurrencyButtons();
  renderDashboard();
}

function initializeCurrencySwitcher() {
  $("#currencyUGX")?.addEventListener("click", () => {
    changeCurrency("UGX");
  });

  $("#currencyUSD")?.addEventListener("click", () => {
    changeCurrency("USD");
  });

  updateCurrencyButtons();
}

// ---------------------------------------------------------
// STATE
// ---------------------------------------------------------

let currentUser = null;

let products = [];
let sales = [];
let debts = [];
let expenses = [];
let customers = [];

let customersCollectionAvailable = false;

const listeners = [];

const loaded = {
  products: false,
  sales: false,
  debts: false,
  expenses: false
};

let listenerErrors = [];
let currentPeriod = "month";

// ---------------------------------------------------------
// DATE AND NUMBER HELPERS
// ---------------------------------------------------------

function getDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRecordDate(record) {
  return (
    record.saleDate ??
    record.debtDate ??
    record.date ??
    record.createdAt ??
    record.created_at ??
    record.timestamp ??
    null
  );
}

function formatDate(value) {
  const date = getDate(value);

  if (!date) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function getTime(value) {
  const date = getDate(value);
  return date ? date.getTime() : 0;
}

function amount(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }

  return 0;
}

// ---------------------------------------------------------
// FINANCIAL FIELD HELPERS
// ---------------------------------------------------------

function saleTotal(sale) {
  return Math.max(0, amount(sale.totalAmount));
}

function salePaid(sale) {
  return Math.max(0, amount(sale.amountPaid));
}

function saleBalance(sale) {
  return Math.max(0, saleTotal(sale) - salePaid(sale));
}

function saleCost(sale) {
  if (sale.totalCost !== undefined && sale.totalCost !== null) {
    return Math.max(0, amount(sale.totalCost));
  }

  if (
    sale.costOfGoodsSold !== undefined &&
    sale.costOfGoodsSold !== null
  ) {
    return Math.max(0, amount(sale.costOfGoodsSold));
  }

  return Math.max(
    0,
    amount(sale.unitBuyingCost) * amount(sale.quantity, 1)
  );
}

function manualDebtTotal(debt) {
  return Math.max(0, amount(debt.totalAmount));
}

function manualDebtPaid(debt) {
  return Math.max(0, amount(debt.amountPaid));
}

function manualDebtBalance(debt) {
  return Math.max(0, manualDebtTotal(debt) - manualDebtPaid(debt));
}

function expenseAmount(expense) {
  return Math.max(
    0,
    amount(expense.amount, expense.totalAmount, expense.cost)
  );
}

// ---------------------------------------------------------
// PERIOD FILTERS
// ---------------------------------------------------------

function getPeriodStart(period) {
  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  switch (period) {
    case "today":
      return start;

    case "week": {
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday);
      return start;
    }

    case "month":
      start.setDate(1);
      return start;

    case "year":
      start.setMonth(0, 1);
      return start;

    case "all":
    default:
      return null;
  }
}

function inPeriod(record, period, dateGetter = getRecordDate) {
  if (period === "all") return true;

  const date = getDate(dateGetter(record));
  if (!date) return false;

  const start = getPeriodStart(period);

  return Boolean(start && date >= start);
}

function recordsInPeriod(records, period, dateGetter = getRecordDate) {
  return records.filter((record) => inPeriod(record, period, dateGetter));
}

// ---------------------------------------------------------
// CUSTOMER COUNT
// ---------------------------------------------------------

function getCustomerCount() {
  if (customersCollectionAvailable) {
    return customers.length;
  }

  const names = new Set();

  [...sales, ...debts].forEach((record) => {
    const name = String(record.customerName ?? "").trim();

    if (
      name &&
      name.toLowerCase() !== "walk-in customer" &&
      name.toLowerCase() !== "unknown customer"
    ) {
      names.add(name.toLowerCase());
    }
  });

  return names.size;
}

// ---------------------------------------------------------
// DEBT ACCOUNTS
// ---------------------------------------------------------

function getOutstandingDebtAccounts(period = currentPeriod) {
  const saleDebts = recordsInPeriod(sales, period)
    .filter((sale) => saleBalance(sale) > 0)
    .map((sale) => ({
      id: sale.id,
      source: "sale",
      customerName: sale.customerName || "Unnamed customer",
      productName: sale.productName || "Sale",
      totalAmount: saleTotal(sale),
      amountPaid: salePaid(sale),
      balance: saleBalance(sale),
      date: getRecordDate(sale)
    }));

  const manualDebtAccounts = recordsInPeriod(
    debts,
    period,
    (debt) =>
      debt.debtDate ??
      debt.saleDate ??
      debt.date ??
      debt.createdAt
  )
    .filter((debt) => manualDebtBalance(debt) > 0)
    .map((debt) => ({
      id: debt.id,
      source: "debt",
      customerName: debt.customerName || "Unnamed customer",
      productName: debt.productName || "Debt account",
      totalAmount: manualDebtTotal(debt),
      amountPaid: manualDebtPaid(debt),
      balance: manualDebtBalance(debt),
      date:
        debt.debtDate ??
        debt.saleDate ??
        debt.date ??
        debt.createdAt
    }));

  return [...saleDebts, ...manualDebtAccounts]
    .sort((a, b) => getTime(b.date) - getTime(a.date));
}

// ---------------------------------------------------------
// FINANCIAL SUMMARY
// ---------------------------------------------------------

function calculateSummary() {
  const periodSales = recordsInPeriod(sales, currentPeriod);

  const periodDebts = recordsInPeriod(
    debts,
    currentPeriod,
    (debt) =>
      debt.debtDate ??
      debt.saleDate ??
      debt.date ??
      debt.createdAt
  );

  const periodExpenses = recordsInPeriod(expenses, currentPeriod);

  const totalSales = periodSales.reduce(
    (sum, sale) => sum + saleTotal(sale), 0
  );

  const totalReceivedFromSales = periodSales.reduce(
    (sum, sale) => sum + salePaid(sale), 0
  );

  const totalReceivedFromManualDebts = periodDebts.reduce(
    (sum, debt) => sum + manualDebtPaid(debt), 0
  );

  const totalReceived =
    totalReceivedFromSales + totalReceivedFromManualDebts;

  const totalDebts = getOutstandingDebtAccounts(currentPeriod)
    .reduce((sum, account) => sum + account.balance, 0);

  const totalCost = periodSales.reduce(
    (sum, sale) => sum + saleCost(sale), 0
  );

  const totalExpenses = periodExpenses.reduce(
    (sum, expense) => sum + expenseAmount(expense), 0
  );

  const grossProfit = totalSales - totalCost;
  const netProfit = grossProfit - totalExpenses;

  return {
    totalSales,
    totalReceived,
    totalDebts,
    totalCost,
    totalExpenses,
    grossProfit,
    netProfit,
    sales: periodSales
  };
}

// ---------------------------------------------------------
// RECENT SALES
// ---------------------------------------------------------

function getSaleStatus(sale) {
  const balance = saleBalance(sale);
  const paid = salePaid(sale);

  if (balance <= 0) {
    return { label: "Paid", className: "status-paid" };
  }

  if (paid > 0) {
    return { label: "Partial", className: "status-partial" };
  }

  return { label: "Unpaid", className: "status-unpaid" };
}

function renderRecentSales(periodSales) {
  const tbody = $("#recent-sales-body");
  if (!tbody) return;

  tbody.replaceChildren();

  const recent = [...periodSales]
    .sort((a, b) => {
      const dateDifference =
        getTime(getRecordDate(b)) - getTime(getRecordDate(a));

      if (dateDifference !== 0) return dateDifference;

      return getTime(b.createdAt) - getTime(a.createdAt);
    })
    .slice(0, 6);

  if (recent.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";

    const cell = document.createElement("td");
    cell.colSpan = 5;

    const empty = document.createElement("div");
    empty.className = "empty-state";

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-receipt";

    const heading = document.createElement("strong");
    heading.textContent = "No sales recorded in this period";

    const detail = document.createElement("span");
    detail.textContent = "Change the period or record a new sale.";

    empty.append(icon, heading, detail);
    cell.append(empty);
    row.append(cell);
    tbody.append(row);
    return;
  }

  recent.forEach((sale) => {
    const row = document.createElement("tr");
    const status = getSaleStatus(sale);

    [
      sale.productName || "Unnamed product",
      sale.customerName || "Walk-in customer",
      formatDate(sale.saleDate ?? sale.createdAt),
      formatMoney(saleTotal(sale))
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");

    badge.className = `status-badge ${status.className}`;
    badge.textContent = status.label;

    statusCell.append(badge);
    row.append(statusCell);
    tbody.append(row);
  });
}

// ---------------------------------------------------------
// RECENT DEBTS
// ---------------------------------------------------------

function renderRecentDebts(accounts) {
  const container = $("#recent-debts-list");
  if (!container) return;

  container.replaceChildren();

  const recent = accounts.slice(0, 4);

  if (recent.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact-empty";

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-circle-check";

    const heading = document.createElement("strong");
    heading.textContent = "No outstanding debts";

    const detail = document.createElement("span");
    detail.textContent = "There are no unpaid balances in this period.";

    empty.append(icon, heading, detail);
    container.append(empty);
    return;
  }

  recent.forEach((debt) => {
    const item = document.createElement("div");
    item.className = "recent-debt-item";

    const person = document.createElement("div");
    person.className = "recent-debt-person";

    const name = document.createElement("strong");
    name.textContent = debt.customerName;

    const product = document.createElement("span");
    product.textContent = debt.productName;

    person.append(name, product);

    const balance = document.createElement("span");
    balance.className = "recent-debt-amount";
    balance.textContent = formatMoney(debt.balance);

    item.append(person, balance);
    container.append(item);
  });
}

// ---------------------------------------------------------
// ERROR / LOADING STATUS
// ---------------------------------------------------------

function renderListenerStatus() {
  const failed = listenerErrors.length > 0;
  const pending = Object.values(loaded).some((value) => !value);

  if (failed) {
    console.error("Dashboard data errors:", listenerErrors);
    document.body.dataset.dashboardStatus = "error";
  } else if (pending) {
    document.body.dataset.dashboardStatus = "loading";
  } else {
    document.body.dataset.dashboardStatus = "ready";
  }
}

// ---------------------------------------------------------
// RENDER DASHBOARD
// ---------------------------------------------------------

function renderDashboard() {
  const summary = calculateSummary();

  const debtAccounts = getOutstandingDebtAccounts(currentPeriod);

  setText("#total-sales", formatMoney(summary.totalSales));
  setText("#total-received", formatMoney(summary.totalReceived));
  setText("#total-debts", formatMoney(summary.totalDebts));
  setText("#net-profit", formatMoney(summary.netProfit));

  setText("#total-cost", formatMoney(summary.totalCost));
  setText("#total-expenses", formatMoney(summary.totalExpenses));

  setText(
    "#total-customers",
    getCustomerCount().toLocaleString("en-UG")
  );

  setText(
    "#total-products",
    products.length.toLocaleString("en-UG")
  );

  setText("#debt-summary-total", formatMoney(summary.totalDebts));

  renderRecentSales(summary.sales);
  renderRecentDebts(debtAccounts);
  renderListenerStatus();
}

// ---------------------------------------------------------
// FIRESTORE LISTENERS
// ---------------------------------------------------------

function listenToCollection(collectionName, onData, onError, loadedKey) {
  const reference = collection(
    db,
    "users",
    currentUser.uid,
    collectionName
  );

  const stop = onSnapshot(
    reference,
    (snapshot) => {
      onData(snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      })));

      if (loadedKey) loaded[loadedKey] = true;

      renderDashboard();
    },
    (error) => {
      console.error(
        `Dashboard ${collectionName} listener failed:`,
        error
      );

      listenerErrors = listenerErrors.filter(
        (item) => item.collection !== collectionName
      );

      listenerErrors.push({
        collection: collectionName,
        code: error.code,
        message: error.message
      });

      if (loadedKey) loaded[loadedKey] = true;

      if (onError) onError(error);

      renderDashboard();
    }
  );

  listeners.push(stop);
}

function stopAllListeners() {
  while (listeners.length) {
    const stop = listeners.pop();

    try {
      stop();
    } catch (error) {
      console.warn("Could not stop dashboard listener:", error);
    }
  }
}

function resetDashboardData() {
  products = [];
  sales = [];
  debts = [];
  expenses = [];
  customers = [];

  customersCollectionAvailable = false;
  listenerErrors = [];

  Object.keys(loaded).forEach((key) => {
    loaded[key] = false;
  });
}

function startDashboardListeners() {
  listenToCollection("products", (records) => {
    products = records;
  }, null, "products");

  listenToCollection("sales", (records) => {
    sales = records;
  }, null, "sales");

  listenToCollection("debts", (records) => {
    debts = records;
  }, null, "debts");

  listenToCollection("expenses", (records) => {
    expenses = records;
  }, null, "expenses");

  const customerRef = collection(
    db,
    "users",
    currentUser.uid,
    "customers"
  );

  const stopCustomers = onSnapshot(
    customerRef,
    (snapshot) => {
      customers = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      customersCollectionAvailable = true;
      renderDashboard();
    },
    (error) => {
      console.warn(
        "Registered customers collection unavailable; using customer names from records.",
        error
      );

      customersCollectionAvailable = false;
      customers = [];

      renderDashboard();
    }
  );

  listeners.push(stopCustomers);
}

// ---------------------------------------------------------
// DATE AND SIDEBAR
// ---------------------------------------------------------

function renderCurrentDate() {
  setText(
    "#current-date",
    new Intl.DateTimeFormat("en-UG", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date())
  );

  setText("#current-year", new Date().getFullYear());
}

function initializeSidebar() {
  const sidebar = $("#sidebar");
  const overlay = $("#sidebar-overlay");
  const openButton = $("#menu-toggle");
  const closeButton = $("#sidebar-close");

  if (!sidebar || !overlay) return;

  function openSidebar() {
    sidebar.classList.add("is-open");
    overlay.classList.add("is-visible");
    openButton?.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    openButton?.setAttribute("aria-expanded", "false");
  }

  openButton?.addEventListener("click", openSidebar);
  closeButton?.addEventListener("click", closeSidebar);
  overlay.addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });

  sidebar.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 760) closeSidebar();
    });
  });
}

// ---------------------------------------------------------
// INITIALIZE DASHBOARD
// ---------------------------------------------------------

function initializeDashboard() {
  renderCurrentDate();
  initializeSidebar();

  // Initialize currency buttons immediately.
  initializeCurrencySwitcher();

  const periodFilter = $("#period-filter");

  if (periodFilter) {
    currentPeriod = periodFilter.value || "month";

    periodFilter.addEventListener("change", () => {
      currentPeriod = periodFilter.value || "month";
      renderDashboard();
    });
  }

  $("#refresh-dashboard")?.addEventListener("click", () => {
    renderCurrentDate();
    renderDashboard();
  });

  document.querySelectorAll(".sidebar-nav .nav-link").forEach((link) => {
    const href = link.getAttribute("href");

    if (href === "index.html" || href === "dashboard.html") {
      link.setAttribute("href", "dashboard.html");
    }
  });

  onAuthStateChanged(auth, (user) => {
    stopAllListeners();
    resetDashboardData();

    if (!user) {
      currentUser = null;
      window.location.href = "./login.html";
      return;
    }

    currentUser = user;

    startDashboardListeners();
    renderDashboard();
  });
}

// ---------------------------------------------------------
// START
// ---------------------------------------------------------

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard,
    { once: true }
  );
} else {
  initializeDashboard();
}
