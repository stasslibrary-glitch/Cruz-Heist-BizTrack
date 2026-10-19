
import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const form = $("expense-form");
const dateInput = $("expense-date");
const categoryInput = $("expense-category");
const descriptionInput = $("expense-description");
const amountInput = $("expense-amount");
const saveButton = $("save-expense");
const searchInput = $("expense-search");
const categoryFilter = $("filter-category");
const tableBody = $("expense-list");
const mobileList = $("mobile-expense-list");
const emptyState = $("empty-state");

let currentUser = null;
let expenses = [];
let stopExpensesListener = null;
let saving = false;
let deletingId = null;
let loadError = false;

const money = (amount) =>
    "UGX " + Math.round(Number(amount) || 0).toLocaleString("en-UG");

function todayString() {
    const now = new Date();
    const local = new Date(
        now.getTime() - now.getTimezoneOffset() * 60000
    );
    return local.toISOString().slice(0, 10);
}

function showAlert(message, type = "success") {
    const alert = $("page-alert");
    alert.textContent = message;
    alert.className = `page-alert ${type}`;
    alert.hidden = false;
}

function hideAlert() {
    $("page-alert").hidden = true;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatDate(value) {
    if (!value) return "—";

    const parts = value.split("-");

    if (parts.length !== 3) return value;

    const date = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function getMonthStart() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
}

function getFilteredExpenses() {
    const query = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;

    return expenses.filter((expense) => {
        const searchable = [
            expense.description,
            expense.category,
            expense.date
        ].join(" ").toLowerCase();

        return (!query || searchable.includes(query)) &&
            (!category || expense.category === category);
    });
}

function renderSummary() {
    const total = expenses.reduce(
        (sum, expense) => sum + (Number(expense.amount) || 0),
        0
    );

    const monthStart = getMonthStart();
    const today = todayString();

    const monthTotal = expenses.reduce((sum, expense) => {
        const date = expense.date || "";
        if (date >= monthStart && date <= today) {
            return sum + (Number(expense.amount) || 0);
        }
        return sum;
    }, 0);

    $("total-expenses").textContent = money(total);
    $("month-expenses").textContent = money(monthTotal);
    $("expense-count").textContent = expenses.length.toLocaleString("en-UG");
}

function renderExpenses() {
    const filtered = getFilteredExpenses();

    const filteredTotal = filtered.reduce(
        (sum, expense) => sum + (Number(expense.amount) || 0),
        0
    );

    $("filtered-total").textContent = money(filteredTotal);

    if (loadError) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    Could not load expenses. Check your connection and Firebase rules.
                </td>
            </tr>`;
        mobileList.innerHTML = "";
        emptyState.hidden = true;
        return;
    }

    tableBody.innerHTML = "";
    mobileList.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    No matching expenses.
                </td>
            </tr>`;
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    for (const expense of filtered) {
        const id = escapeHTML(expense.id);
        const date = escapeHTML(formatDate(expense.date));
        const description = escapeHTML(expense.description || "Untitled expense");
        const category = escapeHTML(expense.category || "Other");
        const amount = money(expense.amount);
        const isDeleting = deletingId === expense.id;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${date}</td>
            <td>${description}</td>
            <td><span class="category-pill">${category}</span></td>
            <td class="amount-cell">${escapeHTML(amount)}</td>
            <td>
                <button class="delete-btn"
                    type="button"
                    data-delete-id="${id}"
                    aria-label="Delete expense"
                    title="Delete expense"
                    ${isDeleting ? "disabled" : ""}>
                    <i class="fa-solid ${isDeleting ? "fa-spinner fa-spin" : "fa-trash"}"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);

        const card = document.createElement("article");
        card.className = "mobile-expense-card";
        card.innerHTML = `
            <div class="mobile-expense-top">
                <div>
                    <div class="mobile-expense-name">${description}</div>
                    <div class="mobile-expense-date">${date}</div>
                </div>
                <div class="mobile-expense-amount">${escapeHTML(amount)}</div>
            </div>
            <div class="mobile-expense-bottom">
                <span class="category-pill">${category}</span>
                <button class="delete-btn"
                    type="button"
                    data-delete-id="${id}"
                    aria-label="Delete expense"
                    title="Delete expense"
                    ${isDeleting ? "disabled" : ""}>
                    <i class="fa-solid ${isDeleting ? "fa-spinner fa-spin" : "fa-trash"}"></i>
                </button>
            </div>`;
        mobileList.appendChild(card);
    }
}

function renderAll() {
    renderSummary();
    renderExpenses();
}

function stopListening() {
    if (stopExpensesListener) {
        stopExpensesListener();
        stopExpensesListener = null;
    }
}

function listenForExpenses(user) {
    stopListening();

    expenses = [];
    loadError = false;
    renderAll();

    $("sync-status").innerHTML =
        '<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting';

    const expensesRef = collection(
        db,
        "users",
        user.uid,
        "expenses"
    );

    stopExpensesListener = onSnapshot(
        expensesRef,
        (snapshot) => {
            expenses = snapshot.docs.map((item) => ({
                id: item.id,
                ...item.data()
            }));

            expenses.sort((a, b) => {
                const dateCompare = String(b.date || "").localeCompare(
                    String(a.date || "")
                );

                if (dateCompare !== 0) return dateCompare;

                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;

                return bTime - aTime;
            });

            loadError = false;

            $("sync-status").innerHTML =
                '<i class="fa-solid fa-circle-check"></i> Live synced';

            renderAll();
        },
        (error) => {
            console.error("Expense listener error:", error);

            loadError = true;

            $("sync-status").innerHTML =
                '<i class="fa-solid fa-triangle-exclamation"></i> Sync error';

            renderAll();
            showAlert(
                "Unable to load expenses. Check that Firestore is enabled and your security rules allow your signed-in account to read its expenses.",
                "error"
            );
        }
    );
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser || saving) return;

    const date = dateInput.value;
    const category = categoryInput.value;
    const description = descriptionInput.value.trim();
    const amount = Number(amountInput.value);

    if (!date || !category || !description ||
        !Number.isFinite(amount) || amount <= 0) {
        showAlert("Please fill in every field with valid information.", "error");
        return;
    }

    if (!Number.isSafeInteger(amount)) {
        showAlert("Enter the amount as a whole number of UGX.", "error");
        return;
    }

    saving = true;
    saveButton.disabled = true;
    saveButton.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Saving expense...';

    hideAlert();

    try {
        await addDoc(
            collection(db, "users", currentUser.uid, "expenses"),
            {
                date,
                category,
                description,
                amount,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }
        );

        form.reset();
        dateInput.value = todayString();

        showAlert("Expense saved successfully! 💜", "success");
    } catch (error) {
        console.error("Could not save expense:", error);

        showAlert(
            error.code === "permission-denied"
                ? "Permission denied. Please check your Firestore security rules."
                : "Could not save the expense. Check your internet connection and try again.",
            "error"
        );
    } finally {
        saving = false;
        saveButton.disabled = false;
        saveButton.innerHTML =
            '<i class="fa-solid fa-plus"></i> Save expense';
    }
});

async function deleteExpense(id) {
    if (!currentUser || deletingId) return;

    const expense = expenses.find((item) => item.id === id);
    if (!expense) return;

    const confirmed = window.confirm(
        `Delete "${expense.description || "this expense"}" (${money(expense.amount)})?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    deletingId = id;
    renderExpenses();

    try {
        await deleteDoc(
            doc(db, "users", currentUser.uid, "expenses", id)
        );

        showAlert("Expense deleted.", "success");
    } catch (error) {
        console.error("Could not delete expense:", error);

        showAlert(
            "Could not delete this expense. Check your Firestore rules and try again.",
            "error"
        );
    } finally {
        deletingId = null;
        renderExpenses();
    }
}

tableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (button) deleteExpense(button.dataset.deleteId);
});

mobileList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (button) deleteExpense(button.dataset.deleteId);
});

searchInput.addEventListener("input", renderExpenses);
categoryFilter.addEventListener("change", renderExpenses);

$("logout-btn").addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error("Logout failed:", error);
        showAlert("Could not log out. Please try again.", "error");
    }
});

dateInput.value = todayString();

onAuthStateChanged(auth, (user) => {
    stopListening();
    currentUser = user;

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    listenForExpenses(user);
});
