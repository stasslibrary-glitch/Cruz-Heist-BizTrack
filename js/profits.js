
import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    collection,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const state = {
    user: null,
    sales: [],
    expenses: [],
    debts: [],
    savings: [],
    ready: { sales: false, expenses: false, debts: false, savings: false },
    errors: {},
    stops: [],
    charts: {},
    from: "",
    to: ""
};

const number = (value) => {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
};

const money = (value) =>
    "UGX " + Math.round(number(value)).toLocaleString("en-UG");

function localDateString(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function shiftDate(dateString, days) {
    const date = new Date(`${dateString}T12:00:00`);
    date.setDate(date.getDate() + days);
    return localDateString(date);
}

function monthStart(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function yearStart(date = new Date()) {
    return `${date.getFullYear()}-01-01`;
}

function formatDate(value) {
    if (!value) return "—";
    const parts = String(value).split("-");
    if (parts.length !== 3) return value;

    const date = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return date.toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric"
    });
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);
}

function showMessage(message, type = "success") {
    const el = $("report-message");
    el.textContent = message;
    el.className = `notice ${type}`;
    el.hidden = false;
}

function hideMessage() {
    $("report-message").hidden = true;
}

function setSyncStatus(message, icon = "fa-circle-check") {
    $("sync-status").innerHTML =
        `<i class="fa-solid ${icon}"></i> ${escapeHTML(message)}`;
}

function stopListeners() {
    state.stops.forEach((stop) => stop());
    state.stops = [];
}

function resetData() {
    state.sales = [];
    state.expenses = [];
    state.debts = [];
    state.savings = [];
    state.ready = { sales: false, expenses: false, debts: false, savings: false };
    state.errors = {};
}

function saleDate(sale) {
    return sale.saleDate || "";
}

function expenseDate(expense) {
    return expense.date || "";
}

function debtDate(debt) {
    return debt.debtDate || debt.saleDate || "";
}

function saleRevenue(sale) {
    return number(sale.totalAmount);
}

function saleCost(sale) {
    if (sale.totalCost !== undefined && sale.totalCost !== null) {
        return number(sale.totalCost);
    }

    return number(sale.unitBuyingCost) * number(sale.quantity);
}

function saleProfit(sale) {
    if (sale.profit !== undefined && sale.profit !== null) {
        return number(sale.profit);
    }

    return saleRevenue(sale) - saleCost(sale);
}

function saleBalance(sale) {
    if (sale.balance !== undefined && sale.balance !== null) {
        return Math.max(0, number(sale.balance));
    }

    return Math.max(0, saleRevenue(sale) - number(sale.amountPaid));
}

function manualDebtBalance(debt) {
    if (debt.balance !== undefined && debt.balance !== null) {
        return Math.max(0, number(debt.balance));
    }

    return Math.max(0, number(debt.totalAmount) - number(debt.amountPaid));
}

function inRange(date, from = state.from, to = state.to) {
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
}

function filteredData() {
    return {
        sales: state.sales.filter((sale) => inRange(saleDate(sale))),
        expenses: state.expenses.filter((expense) => inRange(expenseDate(expense))),
        debts: state.debts.filter((debt) => inRange(debtDate(debt))),
    };
}

function getCurrentRange() {
    const today = localDateString();
    const preset = $("date-preset").value;

    if (preset === "all") {
        return { from: "", to: "" };
    }

    if (preset === "today") {
        return { from: today, to: today };
    }

    if (preset === "week") {
        const date = new Date(`${today}T12:00:00`);
        const weekday = (date.getDay() + 6) % 7;
        return { from: shiftDate(today, -weekday), to: today };
    }

    if (preset === "last30") {
        return { from: shiftDate(today, -29), to: today };
    }

    if (preset === "year") {
        return { from: yearStart(), to: today };
    }

    if (preset === "custom") {
        return {
            from: $("date-from").value,
            to: $("date-to").value
        };
    }

    return { from: monthStart(), to: today };
}

function updateRangeInputs(range) {
    $("date-from").value = range.from;
    $("date-to").value = range.to;
}

function applyDateFilter() {
    const range = getCurrentRange();

    if (range.from && range.to && range.from > range.to) {
        showMessage("The start date cannot be later than the end date.", "error");
        return;
    }

    state.from = range.from;
    state.to = range.to;
    hideMessage();
    renderAll();
}

function updatePeriodLabel() {
    let label = "All recorded dates";

    if (state.from && state.to) {
        label = `${formatDate(state.from)} – ${formatDate(state.to)}`;
    } else if (state.from) {
        label = `From ${formatDate(state.from)}`;
    } else if (state.to) {
        label = `Up to ${formatDate(state.to)}`;
    }

    $("period-label").textContent = `Showing records: ${label}`;
}

function sum(items, fn) {
    return items.reduce((total, item) => total + number(fn(item)), 0);
}

function renderMetrics(data) {
    const revenue = sum(data.sales, saleRevenue);
    const costs = sum(data.sales, saleCost);
    const grossProfit = sum(data.sales, saleProfit);
    const expenses = sum(data.expenses, (item) => item.amount);
    const netProfit = grossProfit - expenses;
    const collected = sum(data.sales, (sale) => sale.amountPaid);
    const outstandingSales = sum(data.sales, saleBalance);

    $("metric-sales").textContent = money(revenue);
    $("metric-costs").textContent = money(costs);
    $("metric-gross").textContent = money(grossProfit);
    $("metric-expenses").textContent = money(expenses);
    $("metric-profit").textContent = money(netProfit);
    $("metric-collected").textContent = money(collected);
    $("metric-debts").textContent = money(outstandingSales);

    $("metric-sales-count").textContent =
        `${data.sales.length.toLocaleString("en-UG")} sales`;
    $("metric-expense-count").textContent =
        `${data.expenses.length.toLocaleString("en-UG")} expense records`;
    $("metric-debt-count").textContent =
        `${data.sales.filter((sale) => saleBalance(sale) > 0).length} sales with outstanding balances`;

    const margin = revenue ? (netProfit / revenue) * 100 : 0;
    $("metric-margin").textContent = `${margin.toFixed(1)}%`;

    $("cash-total").textContent = money(revenue);
    $("cash-sales").textContent = money(collected);
    $("unpaid-sales").textContent = money(outstandingSales);

    const manualDebts = state.debts.filter((debt) => inRange(debtDate(debt)));
    const manualOutstanding = sum(manualDebts, manualDebtBalance);
    $("unpaid-manual").textContent = money(manualOutstanding);

    $("expense-period-total").textContent = money(expenses);
    $("expense-history-count").textContent =
        `${data.expenses.length.toLocaleString("en-UG")} records`;

    $("profit-per-100").textContent =
        revenue ? money((netProfit / revenue) * 100) : "UGX 0";

    if (!data.sales.length && !data.expenses.length) {
        $("report-insight").textContent =
            "No sales or expenses were found in this date range. Add records or choose a different period.";
    } else if (netProfit > 0) {
        $("report-insight").textContent =
            `Your business recorded ${money(netProfit)} in net profit during this period, after subtracting recorded expenses from gross profit. Keep monitoring your product costs and spending.`;
    } else if (netProfit < 0) {
        $("report-insight").textContent =
            `Recorded expenses and product costs exceed revenue by ${money(Math.abs(netProfit))} for this period. Review spending and selling prices.`;
    } else {
        $("report-insight").textContent =
            "Your net profit is currently zero for this period. Review your sales, product costs and expenses for more detail.";
    }
}

function renderExpenseHistory(data) {
    const body = $("expense-history-body");
    const items = [...data.expenses].sort((a, b) =>
        expenseDate(b).localeCompare(expenseDate(a))
    );

    if (!items.length) {
        body.innerHTML = `
            <tr><td colspan="4" class="empty-cell">
                No expenses recorded in this period.
            </td></tr>`;
        return;
    }

    body.innerHTML = items.map((expense) => `
        <tr>
            <td>${escapeHTML(formatDate(expenseDate(expense)))}</td>
            <td>${escapeHTML(expense.description || "Expense")}</td>
            <td>${escapeHTML(expense.category || "Other")}</td>
            <td class="money-cell">${escapeHTML(money(expense.amount))}</td>
        </tr>
    `).join("");
}

function renderProductReport(data) {
    const body = $("product-report-body");
    const products = new Map();

    for (const sale of data.sales) {
        const name = sale.productName || "Unnamed product";
        const current = products.get(name) || {
            name, quantity: 0, revenue: 0, cost: 0, profit: 0
        };

        current.quantity += number(sale.quantity);
        current.revenue += saleRevenue(sale);
        current.cost += saleCost(sale);
        current.profit += saleProfit(sale);

        products.set(name, current);
    }

    const rows = [...products.values()].sort((a, b) => b.profit - a.profit);

    if (!rows.length) {
        body.innerHTML = `
            <tr><td colspan="5" class="empty-cell">
                No product sales found in this period.
            </td></tr>`;
        return rows;
    }

    body.innerHTML = rows.map((product) => `
        <tr>
            <td>${escapeHTML(product.name)}</td>
            <td>${product.quantity.toLocaleString("en-UG")}</td>
            <td class="money-cell">${escapeHTML(money(product.revenue))}</td>
            <td>${escapeHTML(money(product.cost))}</td>
            <td class="${product.profit >= 0 ? "positive" : "negative"}">
                ${escapeHTML(money(product.profit))}
            </td>
        </tr>
    `).join("");

    return rows;
}

function monthKey(date) {
    return date ? date.slice(0, 7) : "";
}

function monthLabel(key) {
    if (!key) return "Unknown";
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric"
    });
}

function dailyLabel(date) {
    const parts = date.split("-");
    if (parts.length !== 3) return date;
    return new Date(+parts[0], +parts[1] - 1, +parts[2])
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function buildTrend(data) {
    const combinedDates = [
        ...data.sales.map(saleDate),
        ...data.expenses.map(expenseDate)
    ].filter(Boolean).sort();

    const useDaily = state.from && state.to &&
        Math.round((new Date(`${state.to}T12:00:00`) -
                    new Date(`${state.from}T12:00:00`)) / 86400000) <= 45;

    const keys = new Set();

    if (useDaily) {
        const from = state.from;
        const to = state.to;
        if (from && to) {
            let cursor = from;
            let safety = 0;
            while (cursor <= to && safety < 50) {
                keys.add(cursor);
                cursor = shiftDate(cursor, 1);
                safety++;
            }
        }
    } else if (combinedDates.length) {
        combinedDates.forEach((date) => keys.add(monthKey(date)));
    }

    if (!keys.size) {
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            keys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
        }
    }

    let sortedKeys = [...keys].sort();

    if (!useDaily && sortedKeys.length > 12) {
        sortedKeys = sortedKeys.slice(-12);
    }

    const buckets = new Map(sortedKeys.map((key) => [
        key, { revenue: 0, costs: 0, expenses: 0, gross: 0, net: 0 }
    ]));

    for (const sale of data.sales) {
        const date = saleDate(sale);
        const key = useDaily ? date : monthKey(date);
        const bucket = buckets.get(key);
        if (!bucket) continue;
        bucket.revenue += saleRevenue(sale);
        bucket.costs += saleCost(sale);
        bucket.gross += saleProfit(sale);
    }

    for (const expense of data.expenses) {
        const date = expenseDate(expense);
        const key = useDaily ? date : monthKey(date);
        const bucket = buckets.get(key);
        if (bucket) bucket.expenses += number(expense.amount);
    }

    for (const bucket of buckets.values()) {
        bucket.net = bucket.gross - bucket.expenses;
    }

    return {
        labels: sortedKeys.map((key) => useDaily ? dailyLabel(key) : monthLabel(key)),
        rows: sortedKeys.map((key) => buckets.get(key))
    };
}

function chartBaseOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: {
                position: "bottom",
                labels: {
                    usePointStyle: true,
                    pointStyle: "circle",
                    boxWidth: 7,
                    padding: 17,
                    color: "#786783",
                    font: { family: "DM Sans", size: 10 }
                }
            },
            tooltip: {
                callbacks: {
                    label(context) {
                        return `${context.dataset.label}: ${money(context.raw)}`;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: "#91819e", font: { family: "DM Sans", size: 10 } },
                border: { display: false }
            },
            y: {
                beginAtZero: true,
                grid: { color: "#f0eaf5" },
                ticks: {
                    color: "#91819e",
                    font: { family: "DM Sans", size: 9 },
                    callback(value) {
                        return number(value).toLocaleString("en-UG");
                    }
                },
                border: { display: false }
            }
        }
    };
}

function replaceChart(id, config) {
    if (state.charts[id]) state.charts[id].destroy();

    const canvas = $(id);
    if (!canvas || !window.Chart) return;

    state.charts[id] = new Chart(canvas, config);
}

function renderCharts(data, productRows) {
    if (!window.Chart) {
        showMessage("Charts could not load. Check your internet connection and reload the page.", "error");
        return;
    }

    const trend = buildTrend(data);
    const labels = trend.labels;
    const rows = trend.rows;

    replaceChart("performance-chart", {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Revenue",
                    data: rows.map((row) => row.revenue),
                    backgroundColor: "#8e5bc1",
                    borderRadius: 5
                },
                {
                    label: "Product costs",
                    data: rows.map((row) => row.costs),
                    backgroundColor: "#82b8df",
                    borderRadius: 5
                },
                {
                    label: "Expenses",
                    data: rows.map((row) => row.expenses),
                    backgroundColor: "#ed8ab3",
                    borderRadius: 5
                }
            ]
        },
        options: chartBaseOptions()
    });

    replaceChart("profit-chart", {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Gross profit",
                    data: rows.map((row) => row.gross),
                    borderColor: "#8c59bd",
                    backgroundColor: "#8c59bd20",
                    fill: true,
                    tension: .35,
                    pointRadius: 3
                },
                {
                    label: "Net profit",
                    data: rows.map((row) => row.net),
                    borderColor: "#2c9b68",
                    backgroundColor: "#2c9b6818",
                    fill: true,
                    tension: .35,
                    pointRadius: 3
                }
            ]
        },
        options: chartBaseOptions()
    });

    const categoryTotals = new Map();
    for (const expense of data.expenses) {
        const category = expense.category || "Other";
        categoryTotals.set(
            category,
            (categoryTotals.get(category) || 0) + number(expense.amount)
        );
    }

    const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
    const palette = [
        "#8e5bc1", "#ed8ab3", "#e0b456", "#67b99a", "#73b5e0",
        "#e88e73", "#a8a0e0", "#8d9eab", "#d2a1d7", "#6e83bf"
    ];

    replaceChart("expense-chart", {
        type: "doughnut",
        data: {
            labels: categories.map(([name]) => name),
            datasets: [{
                data: categories.map(([, amount]) => amount),
                backgroundColor: categories.map((_, index) => palette[index % palette.length]),
                borderColor: "#ffffff",
                borderWidth: 3,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "65%",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return `${context.label}: ${money(context.raw)}`;
                        }
                    }
                }
            }
        }
    });

    $("expense-legend").innerHTML = categories.length
        ? categories.map(([name, amount], index) => `
            <div class="legend-item">
                <span class="legend-label">
                    <span class="legend-dot" style="background:${palette[index % palette.length]}"></span>
                    <span class="legend-name">${escapeHTML(name)}</span>
                </span>
                <strong>${escapeHTML(money(amount))}</strong>
            </div>
        `).join("")
        : '<p class="small-note">No expense categories to chart yet.</p>';

    const topProducts = productRows.slice(0, 8).reverse();

    replaceChart("product-chart", {
        type: "bar",
        data: {
            labels: topProducts.map((product) => product.name),
            datasets: [{
                label: "Gross profit",
                data: topProducts.map((product) => product.profit),
                backgroundColor: topProducts.map((product) =>
                    product.profit >= 0 ? "#8e5bc1" : "#e77d9b"
                ),
                borderRadius: 6
            }]
        },
        options: {
            ...chartBaseOptions(),
            indexAxis: "y",
            plugins: {
                ...chartBaseOptions().plugins,
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: "#f0eaf5" },
                    ticks: {
                        color: "#91819e",
                        font: { family: "DM Sans", size: 9 },
                        callback(value) { return number(value).toLocaleString("en-UG"); }
                    },
                    border: { display: false }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: "#786783", font: { family: "DM Sans", size: 10 } },
                    border: { display: false }
                }
            }
        }
    });
}

function renderAll() {
    updatePeriodLabel();

    const data = filteredData();
    renderMetrics(data);
    renderExpenseHistory(data);
    const products = renderProductReport(data);
    renderCharts(data, products);

    const failed = Object.keys(state.errors);
    if (failed.length) {
        setSyncStatus("Some data unavailable", "fa-triangle-exclamation");
    } else if (Object.values(state.ready).every(Boolean)) {
        setSyncStatus("Live synced", "fa-circle-check");
    } else {
        setSyncStatus("Loading records", "fa-circle-notch fa-spin");
    }
}

function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
}

function exportCSV() {
    const data = filteredData();

    const rows = [
        ["Date", "Product", "Quantity", "Revenue (UGX)", "Product cost (UGX)", "Gross profit (UGX)", "Collected (UGX)", "Outstanding (UGX)"],
        ...data.sales.map((sale) => [
            saleDate(sale),
            sale.productName || "Unnamed product",
            number(sale.quantity),
            saleRevenue(sale),
            saleCost(sale),
            saleProfit(sale),
            number(sale.amountPaid),
            saleBalance(sale)
        ])
    ];

    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cruz-heist-sales-${localDateString()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function listenCollection(user, collectionName, stateKey) {
    const ref = collection(db, "users", user.uid, collectionName);

    const stop = onSnapshot(ref, (snapshot) => {
        state[stateKey] = snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
        }));

        state.ready[stateKey] = true;
        delete state.errors[stateKey];

        renderAll();
    }, (error) => {
        console.error(`Could not read ${collectionName}:`, error);
        state.ready[stateKey] = true;
        state.errors[stateKey] = error.code || "read-error";

        showMessage(
            `Could not load ${collectionName}. Check your Firestore rules and connection. (${error.code || "unknown error"})`,
            "error"
        );

        renderAll();
    });

    state.stops.push(stop);
}

$("date-preset").addEventListener("change", () => {
    const preset = $("date-preset").value;
    const range = getCurrentRange();

    if (preset !== "custom") {
        updateRangeInputs(range);
        state.from = range.from;
        state.to = range.to;
        hideMessage();
        renderAll();
    }
});

$("apply-filter").addEventListener("click", applyDateFilter);
$("export-btn").addEventListener("click", exportCSV);

$("date-from").addEventListener("change", () => {
    $("date-preset").value = "custom";
});
$("date-to").addEventListener("change", () => {
    $("date-preset").value = "custom";
});

$("logout-btn").addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error("Logout failed:", error);
        showMessage("Unable to sign out. Please try again.", "error");
    }
});

onAuthStateChanged(auth, (user) => {
    stopListeners();
    resetData();
    state.user = user;

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    const range = getCurrentRange();
    state.from = range.from;
    state.to = range.to;
    updateRangeInputs(range);

    setSyncStatus("Connecting", "fa-circle-notch fa-spin");

    listenCollection(user, "sales", "sales");
    listenCollection(user, "expenses", "expenses");
    listenCollection(user, "debts", "debts");
    listenCollection(user, "savingsTransactions", "savings");
});
