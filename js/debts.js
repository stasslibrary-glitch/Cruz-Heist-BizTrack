
/* =========================================================
   CRUZ HEIST GRAPHICS LAB — DEBTS & PAYMENTS
   Firebase Authentication + Cloud Firestore
   ========================================================= */

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
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ---------------------------------------------------------
// ELEMENTS AND STATE
// ---------------------------------------------------------

const $ = (id) => document.getElementById(id);

const debtForm = $("debt-form");
const paymentForm = $("payment-form");
const paymentDialog = $("payment-dialog");

const debtDate = $("debt-date");
const debtCustomer = $("debt-customer");
const debtProduct = $("debt-product");
const debtTotal = $("debt-total");
const debtPaid = $("debt-paid");
const debtNotes = $("debt-notes");

const debtSearch = $("debt-search");
const debtFilter = $("debt-filter");

const tableWrap = $("debt-table-wrap");
const tableBody = $("debt-table-body");
const mobileList = $("debt-mobile-list");
const recordsLoading = $("records-loading");
const recordsEmpty = $("records-empty");

const pageAlert = $("page-alert");
const paymentAlert = $("payment-alert");
const saveDebtButton = $("save-debt-btn");
const submitPaymentButton = $("submit-payment");
const toast = $("toast");

let currentUser = null;
let salesRecords = [];
let manualDebts = [];

let stopSalesListener = null;
let stopDebtsListener = null;
let toastTimeout = null;
let isSavingDebt = false;
let isSavingPayment = false;

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function formatMoney(value) {
  return "UGX " + new Intl.NumberFormat("en-UG").format(
    Number(value) || 0
  );
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entities[character];
  });
}

function getToday() {
  const now = new Date();
  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  return localDate.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "—";

  const parts = String(value).split("-");

  if (parts.length !== 3) return "—";

  const date = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function showAlert(element, message, type = "error") {
  element.textContent = message;
  element.classList.toggle("success", type === "success");
  element.hidden = false;
}

function hideAlert(element) {
  element.hidden = true;
  element.textContent = "";
}

function getAccountStatus(account) {
  const total = Number(account.totalAmount) || 0;
  const paid = Number(account.amountPaid) || 0;
  const balance = Math.max(0, total - paid);

  if (balance === 0) return "paid";
  if (paid > 0) return "partial";

  return "unpaid";
}

function statusLabel(status) {
  return {
    paid: "Paid",
    partial: "Part paid",
    unpaid: "Unpaid"
  }[status] || "Unpaid";
}

function statusClass(status) {
  return {
    paid: "status-paid",
    partial: "status-partial",
    unpaid: "status-unpaid"
  }[status] || "status-unpaid";
}

// ---------------------------------------------------------
// ACCOUNT NORMALIZATION
// ---------------------------------------------------------

function getManualAccounts() {
  return manualDebts.map((item) => ({
    id: item.id,
    source: "debt",
    date: item.debtDate || item.saleDate || "",
    customerName: item.customerName || "",
    productName: item.productName || "",
    totalAmount: Number(item.totalAmount) || 0,
    amountPaid: Number(item.amountPaid) || 0,
    balance: Math.max(
      0,
      (Number(item.totalAmount) || 0) -
      (Number(item.amountPaid) || 0)
    ),
    notes: item.notes || "",
    raw: item
  }));
}

function getSalesAccounts() {
  return salesRecords
    .filter((sale) => {
      const total = Number(sale.totalAmount) || 0;
      const paid = Number(sale.amountPaid) || 0;

      // Ordinary fully-paid sales aren't debt accounts.
      // If a sale had an outstanding balance, show it here
      // until it is paid in full.
      return total > paid;
    })
    .map((sale) => ({
      id: sale.id,
      source: "sale",
      date: sale.saleDate || "",
      customerName: sale.customerName || "",
      productName: sale.productName || "",
      totalAmount: Number(sale.totalAmount) || 0,
      amountPaid: Number(sale.amountPaid) || 0,
      balance: Math.max(
        0,
        (Number(sale.totalAmount) || 0) -
        (Number(sale.amountPaid) || 0)
      ),
      notes: sale.notes || "",
      raw: sale
    }));
}

function getAllAccounts() {
  return [
    ...getManualAccounts(),
    ...getSalesAccounts()
  ].sort((a, b) => {
    const dateCompare = String(b.date).localeCompare(String(a.date));

    if (dateCompare !== 0) return dateCompare;

    const timeA = a.raw.createdAt?.toMillis?.() || 0;
    const timeB = b.raw.createdAt?.toMillis?.() || 0;

    return timeB - timeA;
  });
}

function getAccount(source, id) {
  if (source === "sale") {
    const sale = salesRecords.find((item) => item.id === id);

    if (!sale) return null;

    return {
      id: sale.id,
      source: "sale",
      date: sale.saleDate || "",
      customerName: sale.customerName || "",
      productName: sale.productName || "",
      totalAmount: Number(sale.totalAmount) || 0,
      amountPaid: Number(sale.amountPaid) || 0,
      balance: Math.max(
        0,
        (Number(sale.totalAmount) || 0) -
        (Number(sale.amountPaid) || 0)
      ),
      raw: sale
    };
  }

  const debt = manualDebts.find((item) => item.id === id);

  if (!debt) return null;

  return {
    id: debt.id,
    source: "debt",
    date: debt.debtDate || debt.saleDate || "",
    customerName: debt.customerName || "",
    productName: debt.productName || "",
    totalAmount: Number(debt.totalAmount) || 0,
    amountPaid: Number(debt.amountPaid) || 0,
    balance: Math.max(
      0,
      (Number(debt.totalAmount) || 0) -
      (Number(debt.amountPaid) || 0)
    ),
    raw: debt
  };
}

// ---------------------------------------------------------
// NEW DEBT BALANCE PREVIEW
// ---------------------------------------------------------

function updateDebtPreview() {
  const total = Number(debtTotal.value);
  const paid = Number(debtPaid.value);

  const validTotal =
    debtTotal.value.trim() !== "" &&
    Number.isSafeInteger(total) &&
    total > 0;

  const validPaid =
    debtPaid.value.trim() !== "" &&
    Number.isSafeInteger(paid) &&
    paid >= 0;

  if (!validTotal || !validPaid) {
    $("debt-balance-preview").textContent = formatMoney(0);
    return;
  }

  $("debt-balance-preview").textContent = formatMoney(
    Math.max(0, total - paid)
  );
}

debtTotal.addEventListener("input", updateDebtPreview);
debtPaid.addEventListener("input", updateDebtPreview);

// ---------------------------------------------------------
// SAVE A MANUAL DEBT
// Path: users/{uid}/debts/{debtId}
// ---------------------------------------------------------

debtForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSavingDebt) return;

  hideAlert(pageAlert);

  if (!currentUser) {
    showAlert(pageAlert, "Please sign in before saving a debt.");
    return;
  }

  const total = Number(debtTotal.value);
  const paid = Number(debtPaid.value);

  if (!debtDate.value || !debtCustomer.value.trim() ||
      !debtProduct.value.trim()) {
    showAlert(pageAlert, "Please fill in all required fields.");
    return;
  }

  if (!Number.isSafeInteger(total) || total <= 0) {
    showAlert(pageAlert, "The total amount must be a positive whole UGX amount.");
    return;
  }

  if (!Number.isSafeInteger(paid) || paid < 0) {
    showAlert(pageAlert, "The amount already paid must be a valid whole UGX amount.");
    return;
  }

  if (paid > total) {
    showAlert(pageAlert, "The amount already paid cannot exceed the total debt.");
    return;
  }

  const balance = total - paid;

  const debtRecord = {
    debtDate: debtDate.value,
    customerName: debtCustomer.value.trim(),
    productName: debtProduct.value.trim(),
    totalAmount: total,
    amountPaid: paid,
    balance,
    paymentStatus:
      balance === 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
    notes: debtNotes.value.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  isSavingDebt = true;
  saveDebtButton.disabled = true;
  saveDebtButton.textContent = "Saving account...";

  try {
    const debtRef = await addDoc(
      collection(db, "users", currentUser.uid, "debts"),
      debtRecord
    );

    // Record the initial amount paid in the payment ledger too.
    if (paid > 0) {
      try {
        await addDoc(
          collection(
            db,
            "users",
            currentUser.uid,
            "debts",
            debtRef.id,
            "payments"
          ),
          {
            amount: paid,
            paymentDate: debtDate.value,
            paymentMethod: "Initial payment",
            note: "Amount already paid when the debt was recorded.",
            createdAt: serverTimestamp()
          }
        );
      } catch (paymentError) {
        console.error("Initial payment history error:", paymentError);

        showAlert(
          pageAlert,
          "The debt was saved, but its initial payment history could not be saved. Check your Firestore rules.",
          "error"
        );

        return;
      }
    }

    debtForm.reset();
    debtDate.value = getToday();
    debtPaid.value = "0";
    updateDebtPreview();

    showAlert(pageAlert, "Debt account saved successfully.", "success");
    showToast("Debt account saved.");
  } catch (error) {
    console.error("Saving debt failed:", error);

    showAlert(
      pageAlert,
      error.code === "permission-denied"
        ? "Firebase denied this save. Check your Firestore security rules."
        : "Could not save this debt account. Check your connection and try again."
    );
  } finally {
    isSavingDebt = false;
    saveDebtButton.disabled = false;
    saveDebtButton.innerHTML = "<span>＋</span> Save debt account";
  }
});

// ---------------------------------------------------------
// FIRESTORE LISTENERS
// ---------------------------------------------------------

function startSalesListener() {
  const salesRef = collection(
    db,
    "users",
    currentUser.uid,
    "sales"
  );

  stopSalesListener = onSnapshot(
    salesRef,
    (snapshot) => {
      salesRecords = snapshot.docs.map((saleDoc) => ({
        id: saleDoc.id,
        ...saleDoc.data()
      }));

      updateSummary();
      renderAccounts();
    },
    (error) => {
      console.error("Sales listener failed:", error);

      showAlert(
        pageAlert,
        "Could not load sales. Check Firestore permissions for the sales collection."
      );

      recordsLoading.hidden = true;
    }
  );
}

function startDebtsListener() {
  const debtsRef = collection(
    db,
    "users",
    currentUser.uid,
    "debts"
  );

  stopDebtsListener = onSnapshot(
    debtsRef,
    (snapshot) => {
      manualDebts = snapshot.docs.map((debtDoc) => ({
        id: debtDoc.id,
        ...debtDoc.data()
      }));

      updateSummary();
      renderAccounts();
    },
    (error) => {
      console.error("Debts listener failed:", error);

      showAlert(
        pageAlert,
        "Could not load debt accounts. Check Firestore permissions for the debts collection."
      );

      recordsLoading.hidden = true;
    }
  );
}

// ---------------------------------------------------------
// SUMMARY CARDS
// ---------------------------------------------------------

function updateSummary() {
  const accounts = getAllAccounts();

  const outstanding = accounts.reduce(
    (sum, account) => sum + account.balance,
    0
  );

  const collected = accounts.reduce(
    (sum, account) => sum + account.amountPaid,
    0
  );

  const owingCustomers = new Set(
    accounts
      .filter((account) => account.balance > 0)
      .map((account) =>
        account.customerName.trim().toLowerCase()
      )
      .filter(Boolean)
  );

  $("summary-outstanding").textContent = formatMoney(outstanding);
  $("summary-collected").textContent = formatMoney(collected);
  $("summary-customers").textContent = String(owingCustomers.size);
  $("summary-accounts").textContent = String(accounts.length);
  $("overview-balance").textContent = formatMoney(outstanding);
}

// ---------------------------------------------------------
// SEARCH AND FILTER
// ---------------------------------------------------------

function getFilteredAccounts() {
  const searchTerm = debtSearch.value.trim().toLowerCase();
  const filter = debtFilter.value;

  return getAllAccounts().filter((account) => {
    const status = getAccountStatus(account);

    let matchesFilter = true;

    if (filter === "owing") {
      matchesFilter = account.balance > 0;
    } else if (filter !== "all") {
      matchesFilter = status === filter;
    }

    const text = [
      account.customerName,
      account.productName,
      account.date,
      account.notes
    ].join(" ").toLowerCase();

    return matchesFilter &&
      (!searchTerm || text.includes(searchTerm));
  });
}

debtSearch.addEventListener("input", renderAccounts);
debtFilter.addEventListener("change", renderAccounts);

// ---------------------------------------------------------
// RENDER DESKTOP AND MOBILE ACCOUNTS
// ---------------------------------------------------------

function renderAccounts() {
  recordsLoading.hidden = true;

  const accounts = getFilteredAccounts();

  tableBody.innerHTML = "";
  mobileList.innerHTML = "";

  if (accounts.length === 0) {
    tableWrap.hidden = true;
    mobileList.hidden = true;
    recordsEmpty.hidden = false;

    recordsEmpty.querySelector("h3").textContent =
      getAllAccounts().length === 0
        ? "No debt accounts yet"
        : "No matching accounts";

    recordsEmpty.querySelector("p").textContent =
      getAllAccounts().length === 0
        ? "Record a debt, or record a sale with an outstanding balance."
        : "Try another search or payment filter.";

    return;
  }

  recordsEmpty.hidden = true;
  tableWrap.hidden = false;
  mobileList.hidden = false;

  for (const account of accounts) {
    const status = getAccountStatus(account);
    const sourceLabel =
      account.source === "sale" ? "From sales" : "Manual account";

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHTML(formatDate(account.date))}</td>
      <td>
        <span class="cell-main">${escapeHTML(account.customerName || "Unnamed customer")}</span>
        <span class="cell-sub">${sourceLabel}</span>
      </td>
      <td>
        <span class="cell-main">${escapeHTML(account.productName || "—")}</span>
      </td>
      <td class="money">${formatMoney(account.totalAmount)}</td>
      <td class="money">${formatMoney(account.amountPaid)}</td>
      <td class="money balance-money">${formatMoney(account.balance)}</td>
      <td><span class="status-pill ${statusClass(status)}">${statusLabel(status)}</span></td>
      <td>
        <div class="row-actions">
          ${
            account.balance > 0
              ? `<button class="action-btn" data-action="payment" data-source="${account.source}" data-id="${escapeHTML(account.id)}" type="button">Add payment</button>`
              : ""
          }
          ${
            account.source === "debt"
              ? `<button class="action-btn danger" data-action="delete" data-source="debt" data-id="${escapeHTML(account.id)}" type="button">Delete</button>`
              : ""
          }
        </div>
      </td>
    `;

    tableBody.appendChild(row);

    const card = document.createElement("article");
    card.className = "mobile-debt-card";

    card.innerHTML = `
      <div class="mobile-debt-top">
        <div>
          <strong>${escapeHTML(account.customerName || "Unnamed customer")}</strong>
          <small>${escapeHTML(account.productName || "—")}</small>
          <small>${escapeHTML(formatDate(account.date))} · ${sourceLabel}</small>
        </div>
        <span class="status-pill ${statusClass(status)}">${statusLabel(status)}</span>
      </div>

      <div class="mobile-debt-grid">
        <div class="mobile-metric">
          <span>Total amount</span>
          <strong>${formatMoney(account.totalAmount)}</strong>
        </div>
        <div class="mobile-metric">
          <span>Amount paid</span>
          <strong>${formatMoney(account.amountPaid)}</strong>
        </div>
        <div class="mobile-metric">
          <span>Balance remaining</span>
          <strong class="balance-money">${formatMoney(account.balance)}</strong>
        </div>
        <div class="mobile-metric">
          <span>Date recorded</span>
          <strong>${escapeHTML(formatDate(account.date))}</strong>
        </div>
      </div>

      <div class="mobile-debt-actions">
        ${
          account.balance > 0
            ? `<button class="action-btn" data-action="payment" data-source="${account.source}" data-id="${escapeHTML(account.id)}" type="button">＋ Add payment</button>`
            : ""
        }
        ${
          account.source === "debt"
            ? `<button class="action-btn danger" data-action="delete" data-source="debt" data-id="${escapeHTML(account.id)}" type="button">Delete account</button>`
            : ""
        }
      </div>
    `;

    mobileList.appendChild(card);
  }
}

// ---------------------------------------------------------
// OPEN PAYMENT DIALOG
// ---------------------------------------------------------

function openPaymentDialog(account) {
  if (!account || account.balance <= 0) {
    showToast("There is no outstanding balance on this account.");
    return;
  }

  hideAlert(paymentAlert);

  $("payment-account-id").value = account.id;
  $("payment-account-source").value = account.source;

  $("payment-account-name").textContent =
    `${account.customerName || "Unnamed customer"} · ${account.productName}`;

  $("payment-outstanding").textContent = formatMoney(account.balance);

  $("payment-date").value = getToday();
  $("payment-amount").value = "";
  $("payment-method").value = "Cash";
  $("payment-note").value = "";

  $("payment-amount").max = String(account.balance);

  if (!paymentDialog.open) {
    paymentDialog.showModal();
  }
}

$("close-payment").addEventListener("click", () => paymentDialog.close());
$("cancel-payment").addEventListener("click", () => paymentDialog.close());

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const action = button.dataset.action;
  const source = button.dataset.source;
  const id = button.dataset.id;

  if (!id || !currentUser) return;

  if (action === "payment") {
    const account = getAccount(source, id);
    openPaymentDialog(account);
  }

  if (action === "delete" && source === "debt") {
    deleteManualDebt(id);
  }
});

// ---------------------------------------------------------
// RECORD AN ADDITIONAL PAYMENT
// Updates the original account and creates a payment-history
// entry in one Firestore transaction.
// ---------------------------------------------------------

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSavingPayment) return;

  hideAlert(paymentAlert);

  if (!currentUser) {
    showAlert(paymentAlert, "Please sign in first.");
    return;
  }

  const source = $("payment-account-source").value;
  const id = $("payment-account-id").value;
  const amount = Number($("payment-amount").value);
  const paymentDate = $("payment-date").value;

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    showAlert(paymentAlert, "Enter a valid positive whole UGX payment.");
    return;
  }

  if (!paymentDate) {
    showAlert(paymentAlert, "Please select the payment date.");
    return;
  }

  if (source !== "sale" && source !== "debt") {
    showAlert(paymentAlert, "This account type is not valid.");
    return;
  }

  const accountRef = doc(
    db,
    "users",
    currentUser.uid,
    source === "sale" ? "sales" : "debts",
    id
  );

  // Use a fixed payment document reference so Firestore retries
  // don't accidentally create duplicate payment records.
  const paymentRef = doc(
    collection(
      db,
      "users",
      currentUser.uid,
      source === "sale" ? "sales" : "debts",
      id,
      "payments"
    )
  );

  const paymentMethod = $("payment-method").value;
  const note = $("payment-note").value.trim();

  isSavingPayment = true;
  submitPaymentButton.disabled = true;
  submitPaymentButton.textContent = "Saving payment...";

  try {
    await runTransaction(db, async (transaction) => {
      const accountSnapshot = await transaction.get(accountRef);

      if (!accountSnapshot.exists()) {
        throw new Error("ACCOUNT_NOT_FOUND");
      }

      const accountData = accountSnapshot.data();

      const total = Number(accountData.totalAmount);
      const currentPaid = Number(accountData.amountPaid) || 0;
      const currentBalance = Math.max(0, total - currentPaid);

      if (!Number.isSafeInteger(total) || total < 0) {
        throw new Error("INVALID_ACCOUNT_TOTAL");
      }

      if (amount > currentBalance) {
        throw new Error("PAYMENT_EXCEEDS_BALANCE");
      }

      const newPaid = currentPaid + amount;
      const newBalance = total - newPaid;

      transaction.update(accountRef, {
        amountPaid: newPaid,
        balance: newBalance,
        paymentStatus:
          newBalance === 0
            ? "paid"
            : newPaid > 0
              ? "partial"
              : "unpaid",
        updatedAt: serverTimestamp()
      });

      transaction.set(paymentRef, {
        amount,
        paymentDate,
        paymentMethod,
        note,
        source,
        createdAt: serverTimestamp()
      });
    });

    paymentDialog.close();
    showToast("Payment recorded successfully.");
  } catch (error) {
    console.error("Recording payment failed:", error);

    let message = "Could not save this payment. Please try again.";

    if (error.message === "ACCOUNT_NOT_FOUND") {
      message = "This account no longer exists. Refresh and try again.";
    } else if (error.message === "PAYMENT_EXCEEDS_BALANCE") {
      message = "The payment is greater than the remaining balance. Refresh the account and try again.";
    } else if (error.message === "INVALID_ACCOUNT_TOTAL") {
      message = "The saved account total is invalid. Check the record before adding a payment.";
    } else if (error.code === "permission-denied") {
      message = "Firebase rules denied the payment update. Check the rules below.";
    }

    showAlert(paymentAlert, message);
  } finally {
    isSavingPayment = false;
    submitPaymentButton.disabled = false;
    submitPaymentButton.textContent = "Save payment";
  }
});

// ---------------------------------------------------------
// DELETE A MANUAL DEBT ACCOUNT
// ---------------------------------------------------------

async function deleteManualDebt(id) {
  if (!currentUser) return;

  const account = manualDebts.find((item) => item.id === id);

  if (!account) {
    showToast("This debt account could not be found.");
    return;
  }

  const confirmed = window.confirm(
    `Delete the debt account for "${account.customerName}"?\n\n` +
    "This will delete the account, but it will not automatically remove its payment-history subcollection."
  );

  if (!confirmed) return;

  try {
    await deleteDoc(
      doc(db, "users", currentUser.uid, "debts", id)
    );

    showToast("Debt account deleted.");
  } catch (error) {
    console.error("Deleting debt failed:", error);

    showToast(
      error.code === "permission-denied"
        ? "Firebase rules do not allow deleting this account."
        : "Could not delete this account."
    );
  }
}

// ---------------------------------------------------------
// LOG OUT
// ---------------------------------------------------------

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "./login.html";
  } catch (error) {
    console.error("Sign-out failed:", error);
    showToast("Could not sign out. Please try again.");
  }
});

// ---------------------------------------------------------
// AUTHENTICATION
// ---------------------------------------------------------

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (stopSalesListener) stopSalesListener();
    if (stopDebtsListener) stopDebtsListener();

    window.location.href = "./login.html";
    return;
  }

  if (currentUser?.uid === user.uid) return;

  if (stopSalesListener) stopSalesListener();
  if (stopDebtsListener) stopDebtsListener();

  currentUser = user;

  startSalesListener();
  startDebtsListener();
});

debtDate.value = getToday();
$("payment-date").value = getToday();
updateDebtPreview();
