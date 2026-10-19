
/* =========================================================
   CRUZ HEIST GRAPHICS LAB — BUSINESS REPORTS
   Sales • Debts • Expenses • Savings • Charts • CSV Export
   Firebase Firestore v12.19.0
   ========================================================= */

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

let currentUser = null;

let sales = [];
let debts = [];
let expenses = [];
let savingsTransactions = [];

let salesLoaded = false;
let debtsLoaded = false;
let expensesLoaded = false;
let savingsLoaded = false;

let salesError = false;
let debtsError = false;
let expensesError = false;
let savingsError = false;

let stopSales = null;
let stopDebts = null;
let stopExpenses = null;
let stopSavings = null;

/* =========================
   GENERAL HELPERS
========================= */

const money = value =>
  "UGX " + Math.round(Number(value) || 0).toLocaleString("en-UG");

const number = value => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

function amountPaid(record) {
  return number(record.amountPaid ?? record.paidAmount ?? record.paid);
}

function totalAmount(record) {
  return number(record.totalAmount ?? record.total ?? record.saleTotal);
}

function balanceAmount(record) {
  if (record.balance !== undefined && record.balance !== null) {
    return Math.max(0, number(record.balance));
  }

  return Math.max(0, totalAmount(record) - amountPaid(record));
}

function recordDate(record) {
  const raw =
    record.saleDate ??
    record.debtDate ??
    record.date ??
    record.createdAt;

  if (!raw) return null;

  if (typeof raw === "string") {
    const parsed = new Date(
      raw.length === 10 ? `${raw}T12:00:00` : raw
    );

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof raw.toDate === "function") return raw.toDate();

  if (typeof raw.seconds === "number") {
    return new Date(raw.seconds * 1000);
  }

  if (typeof raw === "number") return new Date(raw);

  return null;
}

function financeDate(record) {
  const raw =
    record.date ??
    record.expenseDate ??
    record.transactionDate ??
    record.createdAt;

  if (!raw) return recordDate(record);

  if (typeof raw === "string") {
    const date = new Date(
      raw.length === 10 ? `${raw}T12:00:00` : raw
    );

    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof raw.toDate === "function") return raw.toDate();

  if (typeof raw.seconds === "number") {
    return new Date(raw.seconds * 1000);
  }

  if (typeof raw === "number") return new Date(raw);

  return null;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function productName(record) {
  return String(
    record.productName ??
    record.product ??
    record.name ??
    "Unnamed product"
  );
}

function quantity(record) {
  return Math.max(1, number(record.quantity ?? record.qty ?? 1));
}

function recordedCost(record) {
  const totalCost = record.totalBuyingCost ?? record.costTotal;

  if (totalCost !== undefined && totalCost !== null) {
    return Math.max(0, number(totalCost));
  }

  const unitCost =
    record.buyingCost ??
    record.unitBuyingCost ??
    record.costPrice ??
    record.purchasePrice;

  if (unitCost === undefined || unitCost === null) {
    return null;
  }

  return Math.max(0, number(unitCost) * quantity(record));
}

function financeAmount(record) {
  return Math.max(0, number(record.amount));
}

function setSyncStatus(text, state = "") {
  const element = $("sync-status");
  if (!element) return;

  element.replaceChildren();

  const dot = document.createElement("span");
  dot.className = "status-dot";

  element.append(dot, document.createTextNode(" " + text));
  element.className = `sync-status ${state}`;
}

function setMessage(message) {
  const element = $("report-message");
  if (element) element.textContent = message;
}

/* =========================
   DATE FILTERS
========================= */

function getDateRange() {
  const fromValue = $("date-from")?.value || "";
  const toValue = $("date-to")?.value || "";

  return {
    from: fromValue ? new Date(`${fromValue}T00:00:00`) : null,
    to: toValue ? new Date(`${toValue}T23:59:59.999`) : null,
    fromValue,
    toValue
  };
}

function inSelectedRange(record, range = getDateRange()) {
  const date = recordDate(record);

  if (!date) return !range.from && !range.to;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;

  return true;
}

function inFinancePeriod(record) {
  const range = getDateRange();
  const date = financeDate(record);

  if (!date) return !range.from && !range.to;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;

  return true;
}

function setPreset(preset) {
  const now = new Date();
  const today = dateKey(now);

  let from = "";
  let to = today;

  if (preset === "today") {
    from = today;
  } else if (preset === "7" || preset === "30") {
    const start = new Date(now);
    start.setDate(start.getDate() - Number(preset) + 1);
    from = dateKey(start);
  } else if (preset === "month") {
    from = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  } else if (preset === "year") {
    from = dateKey(new Date(now.getFullYear(), 0, 1));
  } else if (preset === "all") {
    from = "";
    to = "";
  } else {
    return;
  }

  $("date-from").value = from;
  $("date-to").value = to;

  renderReports();
}

/* =========================
   MAIN REPORTS
========================= */

function renderReports() {
  if (!salesLoaded || !debtsLoaded) return;

  const range = getDateRange();

  const periodSales = sales.filter(s => inSelectedRange(s, range));
  const periodDebts = debts.filter(d => inSelectedRange(d, range));

  const revenue = periodSales.reduce(
    (sum, sale) => sum + totalAmount(sale),
    0
  );

  const collectedFromSales = periodSales.reduce(
    (sum, sale) => sum + amountPaid(sale),
    0
  );

  const outstandingSales = sales.reduce(
    (sum, sale) => sum + balanceAmount(sale),
    0
  );

  const manualDebtOutstanding = debts.reduce(
    (sum, debt) => sum + balanceAmount(debt),
    0
  );

  const manualDebtCollected = periodDebts.reduce(
    (sum, debt) => sum + amountPaid(debt),
    0
  );

  const missingCostCount = periodSales.filter(
    sale => recordedCost(sale) === null
  ).length;

  const knownGrossProfit = periodSales.reduce((sum, sale) => {
    const cost = recordedCost(sale);

    return cost === null
      ? sum
      : sum + totalAmount(sale) - cost;
  }, 0);

  $("metric-sales").textContent = money(revenue);

  $("metric-sales-count").textContent =
    `${periodSales.length} recorded sale${periodSales.length === 1 ? "" : "s"}`;

  $("metric-profit").textContent = money(knownGrossProfit);
  $("metric-collected").textContent = money(collectedFromSales);

  $("metric-debts").textContent =
    money(outstandingSales + manualDebtOutstanding);

  const owingCount =
    sales.filter(s => balanceAmount(s) > 0).length +
    debts.filter(d => balanceAmount(d) > 0).length;

  $("metric-debt-count").textContent =
    `${owingCount} outstanding account${owingCount === 1 ? "" : "s"}`;

  $("cash-sales").textContent = money(collectedFromSales);
  $("cash-debts").textContent = money(manualDebtCollected);
  $("cash-total").textContent =
    money(collectedFromSales + manualDebtCollected);

  $("unpaid-sales").textContent = money(outstandingSales);
  $("unpaid-manual").textContent = money(manualDebtOutstanding);

  const fromText = range.fromValue || "Beginning";
  const toText = range.toValue || "Today";

  $("period-label").textContent =
    !range.from && !range.to
      ? "All time"
      : `${fromText} — ${toText}`;

  if (missingCostCount > 0) {
    setMessage(
      `${missingCostCount} sale(s) have no saved buying cost. ` +
      "Gross profit is incomplete until those records have their original costs."
    );
  } else {
    setMessage("");
  }

  renderChart(periodSales);
  renderProductTable(periodSales);
  renderFinanceSections();
}

/* =========================
   SALES CHART
========================= */

function renderChart(records) {
  const container = $("sales-chart");
  container.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No sales found for this period.";
    container.append(empty);
    return;
  }

  const monthly = new Map();

  for (const sale of records) {
    const date = recordDate(sale);
    if (!date) continue;

    const key =
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    if (!monthly.has(key)) {
      monthly.set(key, { sales: 0, profit: 0 });
    }

    const item = monthly.get(key);
    item.sales += totalAmount(sale);

    const cost = recordedCost(sale);

    if (cost !== null) {
      item.profit += totalAmount(sale) - cost;
    }
  }

  const entries = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Add dates to your sales to display the chart.";
    container.append(empty);
    return;
  }

  const max = Math.max(
    1,
    ...entries.flatMap(([, item]) => [
      item.sales,
      Math.max(0, item.profit)
    ])
  );

  for (const [key, values] of entries) {
    const [year, month] = key.split("-").map(Number);

    const label = new Date(year, month - 1, 1)
      .toLocaleDateString("en-UG", { month: "short" });

    const column = document.createElement("div");
    column.className = "chart-column";

    const pair = document.createElement("div");
    pair.className = "bar-pair";

    const salesBar = document.createElement("div");
    salesBar.className = "bar sales-bar";
    salesBar.style.height =
      `${Math.max(3, values.sales / max * 100)}%`;
    salesBar.title = `Sales: ${money(values.sales)}`;

    const profitBar = document.createElement("div");
    profitBar.className = "bar profit-bar";
    profitBar.style.height =
      `${Math.max(3, Math.max(0, values.profit) / max * 100)}%`;
    profitBar.title = `Gross profit: ${money(values.profit)}`;

    pair.append(salesBar, profitBar);

    const caption = document.createElement("small");
    caption.textContent = label;

    column.append(pair, caption);
    container.append(column);
  }
}

/* =========================
   PRODUCT PERFORMANCE
========================= */

function renderProductTable(records) {
  const body = $("product-report-body");
  const mobile = $("product-report-mobile");

  body.replaceChildren();
  mobile.replaceChildren();

  const products = new Map();

  for (const sale of records) {
    const name = productName(sale);

    if (!products.has(name)) {
      products.set(name, {
        units: 0,
        sales: 0,
        cost: 0,
        hasMissingCost: false
      });
    }

    const item = products.get(name);

    item.units += quantity(sale);
    item.sales += totalAmount(sale);

    const cost = recordedCost(sale);

    if (cost === null) {
      item.hasMissingCost = true;
    } else {
      item.cost += cost;
    }
  }

  const rows = [...products.entries()]
    .sort(([, a], [, b]) => b.sales - a.sales);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 5;
    td.className = "empty-state";
    td.textContent = "No product sales in this period.";

    tr.append(td);
    body.append(tr);
    return;
  }

  for (const [name, item] of rows) {
    const profit = item.sales - item.cost;

    const values = [
      name,
      `${item.units} units`,
      money(item.sales),
      item.hasMissingCost
        ? `${money(item.cost)} + unknown`
        : money(item.cost),
      item.hasMissingCost ? "Incomplete" : money(profit)
    ];

    const tr = document.createElement("tr");

    values.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = value;

      if (index === 4 && !item.hasMissingCost) {
        td.className = profit >= 0 ? "profit-value" : "negative-value";
      }

      tr.append(td);
    });

    body.append(tr);

    const card = document.createElement("article");
    card.className = "mobile-product-card";

    const title = document.createElement("strong");
    title.textContent = name;

    const details = document.createElement("p");
    details.textContent =
      `${item.units} units · Sales ${money(item.sales)}`;

    const profitText = document.createElement("p");
    profitText.textContent = item.hasMissingCost
      ? "Profit unavailable: some buying costs are missing."
      : `Gross profit: ${money(profit)}`;

    card.append(title, details, profitText);
    mobile.append(card);
  }
}

/* =========================
   EXPENSES & SAVINGS
========================= */

function renderFinanceSections() {
  if (!expensesLoaded || !savingsLoaded) return;

  const periodExpenses = expenses.filter(inFinancePeriod);
  const periodSavings = savingsTransactions.filter(inFinancePeriod);

  const expenseTotal = periodExpenses.reduce(
    (sum, item) => sum + financeAmount(item),
    0
  );

  const allDeposits = savingsTransactions
    .filter(item => item.type === "deposit")
    .reduce((sum, item) => sum + financeAmount(item), 0);

  const allWithdrawals = savingsTransactions
    .filter(item => item.type === "withdrawal")
    .reduce((sum, item) => sum + financeAmount(item), 0);

  const periodDeposits = periodSavings
    .filter(item => item.type === "deposit")
    .reduce((sum, item) => sum + financeAmount(item), 0);

  const periodWithdrawals = periodSavings
    .filter(item => item.type === "withdrawal")
    .reduce((sum, item) => sum + financeAmount(item), 0);

  $("expense-period-total").textContent = money(expenseTotal);
  $("savings-current-balance").textContent =
    money(allDeposits - allWithdrawals);

  $("savings-period-deposits").textContent = money(periodDeposits);
  $("savings-period-withdrawals").textContent = money(periodWithdrawals);

  renderFinanceHistory(
    $("expense-history"),
    periodExpenses,
    "expense"
  );

  renderFinanceHistory(
    $("savings-history"),
    periodSavings,
    "savings"
  );

  const periodSales = sales.filter(sale => inSelectedRange(sale));
  const knownGrossProfit = periodSales.reduce((sum, sale) => {
    const cost = recordedCost(sale);

    return cost === null
      ? sum
      : sum + totalAmount(sale) - cost;
  }, 0);

  $("metric-profit").textContent =
    money(knownGrossProfit - expenseTotal);

  const profitLabel = $("metric-profit")
    .closest(".metric-card")
    ?.querySelector("small");

  if (profitLabel) {
    profitLabel.textContent = "Profit after recorded expenses";
  }
}

function renderFinanceHistory(container, records, type) {
  container.replaceChildren();

  const sorted = [...records]
    .sort((a, b) =>
      (financeDate(b)?.getTime() ?? 0) -
      (financeDate(a)?.getTime() ?? 0)
    )
    .slice(0, 12);

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      `No ${type === "expense" ? "expenses" : "savings transactions"} in this period.`;

    container.append(empty);
    return;
  }

  for (const record of sorted) {
    const row = document.createElement("div");
    row.className = "finance-record";

    const main = document.createElement("div");
    main.className = "finance-record-main";

    const title = document.createElement("strong");

    title.textContent = type === "expense"
      ? `${record.category || "Other"} — ${record.description || "Expense"}`
      : record.type === "deposit"
        ? "Savings deposit"
        : "Savings withdrawal";

    const details = document.createElement("small");
    const date = financeDate(record);

    details.textContent = [
      date ? date.toLocaleDateString("en-GB") : "Date not recorded",
      type === "savings" ? (record.note || "") : ""
    ].filter(Boolean).join(" · ");

    main.append(title, details);

    const side = document.createElement("div");
    side.className = "finance-record-side";

    const amount = document.createElement("strong");

    amount.textContent =
      `${record.type === "withdrawal" ? "−" : ""}${money(financeAmount(record))}`;

    if (record.type === "deposit") amount.className = "deposit-amount";
    if (record.type === "withdrawal") amount.className = "withdrawal-amount";

    side.append(amount);
    row.append(main, side);
    container.append(row);
  }
}

/* =========================
   ADD EXPENSE
========================= */

$("expense-date").value = dateKey(new Date());
$("savings-date").value = dateKey(new Date());

$("expense-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) return;

  const amount = number($("expense-amount").value);
  const description = $("expense-description").value.trim();

  if (!description || amount <= 0) {
    setMessage("Enter a valid expense description and amount.");
    return;
  }

  const button = $("save-expense");
  button.disabled = true;

  try {
    await addDoc(
      collection(db, "users", currentUser.uid, "expenses"),
      {
        date: $("expense-date").value,
        category: $("expense-category").value,
        description,
        amount,
        createdAt: serverTimestamp()
      }
    );

    $("expense-form").reset();
    $("expense-date").value = dateKey(new Date());
    setMessage("Expense recorded successfully.");
  } catch (error) {
    console.error("Saving expense failed:", error);
    setMessage("Could not save expense. Check Firestore Rules.");
  } finally {
    button.disabled = false;
  }
});

/* =========================
   ADD SAVINGS TRANSACTION
========================= */

$("savings-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) return;

  const amount = number($("savings-amount").value);
  const type = $("savings-type").value;
  const note = $("savings-note").value.trim();

  if (amount <= 0 || !note) {
    setMessage("Enter a valid savings amount and note.");
    return;
  }

  const currentBalance = savingsTransactions.reduce((sum, item) => {
    return sum + (
      item.type === "deposit"
        ? financeAmount(item)
        : -financeAmount(item)
    );
  }, 0);

  if (type === "withdrawal" && amount > currentBalance) {
    setMessage(
      `Insufficient savings. Available savings: ${money(currentBalance)}.`
    );
    return;
  }

  const button = $("save-savings");
  button.disabled = true;

  try {
    await addDoc(
      collection(db, "users", currentUser.uid, "savingsTransactions"),
      {
        date: $("savings-date").value,
        type,
        amount,
        note,
        createdAt: serverTimestamp()
      }
    );

    $("savings-form").reset();
    $("savings-date").value = dateKey(new Date());
    $("savings-type").value = "deposit";

    setMessage("Savings transaction recorded successfully.");
  } catch (error) {
    console.error("Saving savings transaction failed:", error);
    setMessage("Could not save savings transaction. Check Firestore Rules.");
  } finally {
    button.disabled = false;
  }
});

/* =========================
   CSV EXPORT
========================= */

function exportCSV() {
  const range = getDateRange();

  const filteredSales = sales.filter(
    sale => inSelectedRange(sale, range)
  );

  const rows = [
    [
      "Date",
      "Customer",
      "Product",
      "Quantity",
      "Sales UGX",
      "Recorded Cost UGX",
      "Gross Profit UGX",
      "Paid UGX",
      "Balance UGX"
    ]
  ];

  for (const sale of filteredSales) {
    const cost = recordedCost(sale);
    const date = recordDate(sale);

    rows.push([
      date ? dateKey(date) : "",
      sale.customerName ?? sale.customer ?? "",
      productName(sale),
      quantity(sale),
      totalAmount(sale),
      cost === null ? "" : cost,
      cost === null ? "" : totalAmount(sale) - cost,
      amountPaid(sale),
      balanceAmount(sale)
    ]);
  }

  const csv = rows.map(row =>
    row.map(value => {
      const text = String(value ?? "");
      return `"${text.replace(/"/g, '""')}"`;
    }).join(",")
  ).join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "cruz-heist-sales-report.csv";
  link.click();

  URL.revokeObjectURL(url);
}

$("export-btn").addEventListener("click", exportCSV);

/* =========================
   FILTER BUTTONS
========================= */

$("date-preset").addEventListener("change", event => {
  const preset = event.target.value;

  if (preset !== "custom") {
    setPreset(preset);
  }
});

$("apply-filter").addEventListener("click", () => {
  const from = $("date-from").value;
  const to = $("date-to").value;

  if (from && to && from > to) {
    setMessage("The start date must be before the end date.");
    return;
  }

  $("date-preset").value = "custom";
  renderReports();
});

/* =========================
   LOG OUT
========================= */

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "./login.html";
  } catch (error) {
    console.error("Sign out failed:", error);
    setMessage("Unable to sign out: " + error.message);
  }
});

/* =========================
   FIREBASE LISTENERS
========================= */

function stopAllListeners() {
  if (stopSales) stopSales();
  if (stopDebts) stopDebts();
  if (stopExpenses) stopExpenses();
  if (stopSavings) stopSavings();

  stopSales = null;
  stopDebts = null;
  stopExpenses = null;
  stopSavings = null;
}

function resetLoadedState() {
  salesLoaded = false;
  debtsLoaded = false;
  expensesLoaded = false;
  savingsLoaded = false;

  salesError = false;
  debtsError = false;
  expensesError = false;
  savingsError = false;

  sales = [];
  debts = [];
  expenses = [];
  savingsTransactions = [];
}

function updateLoadedState() {
  if (salesError || debtsError || expensesError || savingsError) {
    setSyncStatus("Permission or connection error", "error");

    const failed = [];

    if (salesError) failed.push("sales");
    if (debtsError) failed.push("debts");
    if (expensesError) failed.push("expenses");
    if (savingsError) failed.push("savings");

    setMessage(
      `Could not load: ${failed.join(", ")}. Check Firestore Rules and the browser Console.`
    );

    return;
  }

  if (
    salesLoaded &&
    debtsLoaded &&
    expensesLoaded &&
    savingsLoaded
  ) {
    setSyncStatus("Live Firebase data", "online");
    renderReports();
  } else {
    setSyncStatus("Loading business records");
  }
}

onAuthStateChanged(auth, user => {
  stopAllListeners();

  if (!user) {
    currentUser = null;
    window.location.href = "./login.html";
    return;
  }

  currentUser = user;
  resetLoadedState();

  setSyncStatus("Loading business records");

  const userPath = ["users", user.uid];

  stopSales = onSnapshot(
    collection(db, ...userPath, "sales"),
    snapshot => {
      sales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      salesLoaded = true;
      salesError = false;
      updateLoadedState();
    },
    error => {
      console.error("Reports sales read failed:", error);
      salesError = true;
      updateLoadedState();
    }
  );

  stopDebts = onSnapshot(
    collection(db, ...userPath, "debts"),
    snapshot => {
      debts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      debtsLoaded = true;
      debtsError = false;
      updateLoadedState();
    },
    error => {
      console.error("Reports debts read failed:", error);
      debtsError = true;
      updateLoadedState();
    }
  );

  stopExpenses = onSnapshot(
    collection(db, ...userPath, "expenses"),
    snapshot => {
      expenses = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      expensesLoaded = true;
      expensesError = false;
      updateLoadedState();
    },
    error => {
      console.error("Reports expenses read failed:", error);
      expensesError = true;
      updateLoadedState();
    }
  );

  stopSavings = onSnapshot(
    collection(db, ...userPath, "savingsTransactions"),
    snapshot => {
      savingsTransactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      savingsLoaded = true;
      savingsError = false;
      updateLoadedState();
    },
    error => {
      console.error("Reports savings read failed:", error);
      savingsError = true;
      updateLoadedState();
    }
  );
});

/* =========================
   DEFAULT REPORT VIEW
========================= */

$("date-preset").value = "all";
setPreset("all");
