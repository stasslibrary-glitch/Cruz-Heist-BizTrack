
/* =========================================================
   CRUZ HEIST GRAPHICS LAB — SALES MANAGEMENT
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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ---------------------------------------------------------
// ELEMENTS
// ---------------------------------------------------------

const $ = (id) => document.getElementById(id);

const saleForm = $("sale-form");
const productSelect = $("product-select");
const saleDateInput = $("sale-date");
const customerInput = $("customer-name");
const quantityInput = $("quantity");
const sellingPriceInput = $("selling-price");
const amountPaidInput = $("amount-paid");
const paymentMethodInput = $("payment-method");
const saveSaleButton = $("save-sale-btn");
const resetButton = $("reset-btn");
const logoutButton = $("logout-btn");

const salesSearch = $("sales-search");
const salesFilter = $("sales-filter");

const salesTableWrap = $("sales-table-wrap");
const salesTableBody = $("sales-table-body");
const salesMobileList = $("sales-mobile-list");
const salesLoading = $("sales-loading");
const salesEmpty = $("sales-empty");

const pageAlert = $("page-alert");
const toast = $("toast");

let currentUser = null;
let products = [];
let sales = [];

let stopProductsListener = null;
let stopSalesListener = null;
let toastTimeout = null;
let isSaving = false;

// ---------------------------------------------------------
// GENERAL HELPERS
// ---------------------------------------------------------

function formatMoney(value) {
  const amount = Number(value) || 0;

  return "UGX " + new Intl.NumberFormat("en-UG").format(amount);
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

  // Our saleDate is stored as YYYY-MM-DD.
  // Parse it as a local calendar date to avoid timezone shifts.
  const parts = String(value).split("-");

  if (parts.length === 3) {
    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      });
    }
  }

  return "—";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function showAlert(message, type = "error") {
  pageAlert.textContent = message;
  pageAlert.classList.toggle("success", type === "success");
  pageAlert.hidden = false;
}

function hideAlert() {
  pageAlert.hidden = true;
  pageAlert.textContent = "";
}

function getPaymentStatus(sale) {
  const total = Number(sale.totalAmount) || 0;
  const paid = Number(sale.amountPaid) || 0;
  const balance = Math.max(0, total - paid);

  if (balance <= 0) return "paid";
  if (paid > 0) return "partial";

  return "unpaid";
}

function paymentStatusLabel(status) {
  const labels = {
    paid: "Paid",
    partial: "Part paid",
    unpaid: "Unpaid"
  };

  return labels[status] || "Unpaid";
}

function statusClass(status) {
  return {
    paid: "status-paid",
    partial: "status-partial",
    unpaid: "status-unpaid"
  }[status] || "status-unpaid";
}

// ---------------------------------------------------------
// FORM DEFAULTS
// ---------------------------------------------------------

function setFormDefaults() {
  saleDateInput.value = getToday();
  quantityInput.value = "1";
  sellingPriceInput.value = "";
  amountPaidInput.value = "0";
  customerInput.value = "";
  paymentMethodInput.value = "Cash";
}

// ---------------------------------------------------------
// LOAD PRODUCTS FROM FIRESTORE
// Path: users/{uid}/products/{productId}
// ---------------------------------------------------------

function startProductsListener() {
  if (!currentUser) return;

  const productsRef = collection(
    db,
    "users",
    currentUser.uid,
    "products"
  );

  stopProductsListener = onSnapshot(
    productsRef,
    (snapshot) => {
      products = snapshot.docs.map((productDoc) => ({
        id: productDoc.id,
        ...productDoc.data()
      }));

      products.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );

      renderProductOptions();
      updateCalculation();
    },
    (error) => {
      console.error("Products loading error:", error);

      productSelect.innerHTML =
        '<option value="">Could not load products</option>';

      showAlert(
        "Your products could not be loaded. Check your Firestore rules and internet connection."
      );
    }
  );
}

function renderProductOptions() {
  const previousValue = productSelect.value;

  productSelect.innerHTML =
    '<option value="">Choose a product...</option>';

  if (products.length === 0) {
    productSelect.innerHTML +=
      '<option value="" disabled>No products saved yet</option>';

    $("product-cost-hint").textContent =
      "Add products on the Products page before recording sales.";

    return;
  }

  for (const product of products) {
    const option = document.createElement("option");

    option.value = product.id;
    option.textContent = product.name || "Unnamed product";

    productSelect.appendChild(option);
  }

  const previousProductStillExists = products.some(
    (product) => product.id === previousValue
  );

  if (previousProductStillExists) {
    productSelect.value = previousValue;
  }

  updateProductHint();
}

function getSelectedProduct() {
  return products.find(
    (product) => product.id === productSelect.value
  ) || null;
}

function updateProductHint() {
  const product = getSelectedProduct();

  if (!product) {
    $("product-cost-hint").textContent =
      "Select a product to see its buying cost.";

    return;
  }

  const cost = Number(product.buyingCost);

  $("product-cost-hint").textContent =
    "Saved buying cost per item: " +
    formatMoney(Number.isFinite(cost) ? cost : 0);
}

// ---------------------------------------------------------
// LIVE SALE CALCULATIONS
// ---------------------------------------------------------

function getCalculation() {
  const product = getSelectedProduct();

  const quantity = Number(quantityInput.value);
  const sellingPrice = Number(sellingPriceInput.value);
  const amountPaid = Number(amountPaidInput.value);

  const buyingCost = product
    ? Number(product.buyingCost)
    : 0;

  const validQuantity =
    Number.isSafeInteger(quantity) && quantity > 0;

  const validSellingPrice =
    sellingPriceInput.value.trim() !== "" &&
    Number.isFinite(sellingPrice) &&
    sellingPrice >= 0;

  const validAmountPaid =
    amountPaidInput.value.trim() !== "" &&
    Number.isFinite(amountPaid) &&
    amountPaid >= 0;

  const validBuyingCost =
    Number.isFinite(buyingCost) && buyingCost >= 0;

  const totalAmount =
    validQuantity && validSellingPrice
      ? quantity * sellingPrice
      : 0;

  const totalCost =
    validQuantity && validBuyingCost
      ? quantity * buyingCost
      : 0;

  const profit = totalAmount - totalCost;

  const balance = Math.max(0, totalAmount - amountPaid);

  return {
    product,
    quantity,
    sellingPrice,
    buyingCost,
    amountPaid,
    totalAmount,
    totalCost,
    profit,
    balance,
    validQuantity,
    validSellingPrice,
    validAmountPaid,
    validBuyingCost
  };
}

function updateCalculation() {
  updateProductHint();

  const result = getCalculation();

  $("preview-total").textContent = formatMoney(result.totalAmount);
  $("preview-cost").textContent = formatMoney(result.totalCost);
  $("preview-profit").textContent = formatMoney(result.profit);
  $("preview-balance").textContent = formatMoney(result.balance);

  const statusElement = $("payment-status");

  if (!result.product) {
    statusElement.textContent =
      "Choose a product to calculate the sale.";
    return;
  }

  if (!result.validQuantity || !result.validSellingPrice) {
    statusElement.textContent =
      "Enter a valid quantity and selling price.";
    return;
  }

  if (!result.validAmountPaid) {
    statusElement.textContent =
      "Enter the amount the customer has paid.";
    return;
  }

  if (result.amountPaid > result.totalAmount) {
    statusElement.textContent =
      "The amount paid cannot exceed the sale total.";
    return;
  }

  if (result.balance === 0) {
    statusElement.textContent =
      "Fully paid. No outstanding customer balance.";
  } else if (result.amountPaid > 0) {
    statusElement.textContent =
      "Part payment received. Remaining balance: " +
      formatMoney(result.balance);
  } else {
    statusElement.textContent =
      "No payment received yet. Outstanding balance: " +
      formatMoney(result.balance);
  }
}

[
  productSelect,
  quantityInput,
  sellingPriceInput,
  amountPaidInput
].forEach((element) => {
  element.addEventListener("input", updateCalculation);
  element.addEventListener("change", updateCalculation);
});

// ---------------------------------------------------------
// SAVE A SALE
// Path: users/{uid}/sales/{saleId}
// ---------------------------------------------------------

saleForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSaving) return;

  hideAlert();

  if (!currentUser) {
    showAlert("Please sign in before recording a sale.");
    return;
  }

  const result = getCalculation();

  if (!result.product) {
    showAlert("Please select a product.");
    productSelect.focus();
    return;
  }

  if (
    !result.validQuantity ||
    !result.validSellingPrice ||
    !result.validAmountPaid ||
    !result.validBuyingCost
  ) {
    showAlert("Please enter valid values in all required fields.");
    return;
  }

  if (
    !Number.isSafeInteger(result.totalAmount) ||
    !Number.isSafeInteger(result.totalCost) ||
    !Number.isSafeInteger(result.amountPaid)
  ) {
    showAlert("Amounts must be valid whole UGX amounts.");
    return;
  }

  if (result.amountPaid > result.totalAmount) {
    showAlert(
      "The amount paid cannot exceed the sale total. Record any extra money separately."
    );
    amountPaidInput.focus();
    return;
  }

  if (!saleDateInput.value) {
    showAlert("Please select the sale date.");
    saleDateInput.focus();
    return;
  }

  if (result.totalAmount > Number.MAX_SAFE_INTEGER) {
    showAlert("This sale total is too large to record safely.");
    return;
  }

  const balance = result.totalAmount - result.amountPaid;

  const saleRecord = {
    productId: result.product.id,
    productName: String(result.product.name || "Unnamed product"),
    quantity: result.quantity,

    // Save the prices as a snapshot.
    unitSellingPrice: result.sellingPrice,
    unitBuyingCost: result.buyingCost,

    totalAmount: result.totalAmount,
    totalCost: result.totalCost,
    profit: result.profit,

    customerName: customerInput.value.trim(),
    saleDate: saleDateInput.value,

    amountPaid: result.amountPaid,
    balance,

    paymentStatus:
      balance === 0
        ? "paid"
        : result.amountPaid > 0
          ? "partial"
          : "unpaid",

    paymentMethod: paymentMethodInput.value,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  isSaving = true;
  saveSaleButton.disabled = true;
  saveSaleButton.textContent = "Saving sale...";

  try {
    await addDoc(
      collection(db, "users", currentUser.uid, "sales"),
      saleRecord
    );

    saleForm.reset();
    setFormDefaults();
    updateCalculation();

    showToast("Sale saved successfully!");
    showAlert(
      "Your sale has been saved to Firebase.",
      "success"
    );
  } catch (error) {
    console.error("Saving sale failed:", error);

    let message = "The sale could not be saved. Please try again.";

    if (error.code === "permission-denied") {
      message =
        "Firebase denied this save. Check your Firestore security rules.";
    } else if (
      error.code === "unavailable" ||
      error.code === "network-request-failed"
    ) {
      message =
        "Connection problem. Check your internet and try again.";
    }

    showAlert(message);
    showToast("Sale was not saved.");
  } finally {
    isSaving = false;
    saveSaleButton.disabled = false;
    saveSaleButton.innerHTML = "<span>＋</span> Save sale";
  }
});

// ---------------------------------------------------------
// LOAD SALES HISTORY FROM FIRESTORE
// ---------------------------------------------------------

function startSalesListener() {
  if (!currentUser) return;

  const salesRef = collection(
    db,
    "users",
    currentUser.uid,
    "sales"
  );

  salesLoading.hidden = false;
  salesTableWrap.hidden = true;
  salesMobileList.hidden = true;
  salesEmpty.hidden = true;

  stopSalesListener = onSnapshot(
    salesRef,
    (snapshot) => {
      sales = snapshot.docs.map((saleDoc) => ({
        id: saleDoc.id,
        ...saleDoc.data()
      }));

      // Sort locally so older records without createdAt still appear.
      sales.sort((a, b) => {
        const dateCompare = String(b.saleDate || "")
          .localeCompare(String(a.saleDate || ""));

        if (dateCompare !== 0) return dateCompare;

        const timeA = a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.toMillis?.() || 0;

        return timeB - timeA;
      });

      updateSummary();
      renderSalesHistory();
    },
    (error) => {
      console.error("Sales loading error:", error);

      salesLoading.hidden = true;
      salesTableWrap.hidden = true;
      salesMobileList.hidden = true;
      salesEmpty.hidden = false;

      salesEmpty.querySelector("h3").textContent =
        "Could not load sales";

      salesEmpty.querySelector("p").textContent =
        "Check your Firestore rules and internet connection.";

      showToast("Unable to load your sales.");
    }
  );
}

// ---------------------------------------------------------
// SUMMARY CARDS
// ---------------------------------------------------------

function updateSummary() {
  const totalSales = sales.reduce(
    (sum, sale) => sum + (Number(sale.totalAmount) || 0),
    0
  );

  const totalCollected = sales.reduce(
    (sum, sale) => sum + (Number(sale.amountPaid) || 0),
    0
  );

  const totalProfit = sales.reduce(
    (sum, sale) => sum + (
      Number.isFinite(Number(sale.profit))
        ? Number(sale.profit)
        : (
            (Number(sale.totalAmount) || 0) -
            (Number(sale.totalCost) || 0)
          )
    ),
    0
  );

  const totalBalance = sales.reduce(
    (sum, sale) => sum + Math.max(
      0,
      Number.isFinite(Number(sale.balance))
        ? Number(sale.balance)
        : (
            (Number(sale.totalAmount) || 0) -
            (Number(sale.amountPaid) || 0)
          )
    ),
    0
  );

  $("total-sales").textContent = formatMoney(totalSales);
  $("total-collected").textContent = formatMoney(totalCollected);
  $("total-profit").textContent = formatMoney(totalProfit);
  $("total-balance").textContent = formatMoney(totalBalance);
}

// ---------------------------------------------------------
// FILTER AND SEARCH
// ---------------------------------------------------------

function getFilteredSales() {
  const searchTerm = salesSearch.value.trim().toLowerCase();
  const filter = salesFilter.value;

  return sales.filter((sale) => {
    const status = getPaymentStatus(sale);

    const matchesStatus =
      filter === "all" || status === filter;

    const searchableText = [
      sale.productName,
      sale.customerName,
      sale.paymentMethod,
      sale.saleDate
    ].join(" ").toLowerCase();

    const matchesSearch =
      !searchTerm || searchableText.includes(searchTerm);

    return matchesStatus && matchesSearch;
  });
}

salesSearch.addEventListener("input", renderSalesHistory);
salesFilter.addEventListener("change", renderSalesHistory);

// ---------------------------------------------------------
// RENDER DESKTOP TABLE + MOBILE CARDS
// ---------------------------------------------------------

function renderSalesHistory() {
  salesLoading.hidden = true;

  const filteredSales = getFilteredSales();

  salesTableBody.innerHTML = "";
  salesMobileList.innerHTML = "";

  if (filteredSales.length === 0) {
    salesTableWrap.hidden = true;
    salesMobileList.hidden = true;
    salesEmpty.hidden = false;

    salesEmpty.querySelector("h3").textContent =
      sales.length === 0 ? "No sales recorded yet" : "No sales found";

    salesEmpty.querySelector("p").textContent =
      sales.length === 0
        ? "Your first saved sale will appear here."
        : "Try another search or payment filter.";

    return;
  }

  salesEmpty.hidden = true;
  salesTableWrap.hidden = false;
  salesMobileList.hidden = false;

  for (const sale of filteredSales) {
    const quantity = Number(sale.quantity) || 0;
    const total = Number(sale.totalAmount) || 0;
    const paid = Number(sale.amountPaid) || 0;

    const cost = Number.isFinite(Number(sale.totalCost))
      ? Number(sale.totalCost)
      : (Number(sale.unitBuyingCost) || 0) * quantity;

    const profit = Number.isFinite(Number(sale.profit))
      ? Number(sale.profit)
      : total - cost;

    const balance = Math.max(
      0,
      Number.isFinite(Number(sale.balance))
        ? Number(sale.balance)
        : total - paid
    );

    const status = getPaymentStatus(sale);

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHTML(formatDate(sale.saleDate))}</td>
      <td>
        <span class="cell-main">${escapeHTML(sale.productName || "Unnamed product")}</span>
        <span class="cell-sub">${escapeHTML(sale.customerName || "Walk-in customer")}</span>
      </td>
      <td>${quantity}</td>
      <td class="money">${formatMoney(total)}</td>
      <td class="money">${formatMoney(paid)}</td>
      <td class="money balance-money">${formatMoney(balance)}</td>
      <td class="money profit-money">${formatMoney(profit)}</td>
      <td><span class="status-pill ${statusClass(status)}">${paymentStatusLabel(status)}</span></td>
      <td>
        <button class="delete-sale" type="button" data-delete-id="${escapeHTML(sale.id)}">
          Delete
        </button>
      </td>
    `;

    salesTableBody.appendChild(row);

    const card = document.createElement("article");
    card.className = "mobile-sale-card";

    card.innerHTML = `
      <div class="mobile-sale-top">
        <div>
          <strong>${escapeHTML(sale.productName || "Unnamed product")}</strong>
          <small>${escapeHTML(formatDate(sale.saleDate))} · ${quantity} item(s)</small>
          <small>${escapeHTML(sale.customerName || "Walk-in customer")}</small>
        </div>
        <span class="status-pill ${statusClass(status)}">${paymentStatusLabel(status)}</span>
      </div>

      <div class="mobile-sale-grid">
        <div class="mobile-sale-metric">
          <span>Sale total</span>
          <strong>${formatMoney(total)}</strong>
        </div>
        <div class="mobile-sale-metric">
          <span>Amount paid</span>
          <strong>${formatMoney(paid)}</strong>
        </div>
        <div class="mobile-sale-metric">
          <span>Balance</span>
          <strong class="balance-money">${formatMoney(balance)}</strong>
        </div>
        <div class="mobile-sale-metric">
          <span>Profit</span>
          <strong class="profit-money">${formatMoney(profit)}</strong>
        </div>
        <div class="mobile-sale-metric">
          <span>Payment method</span>
          <strong>${escapeHTML(sale.paymentMethod || "Other")}</strong>
        </div>
        <div class="mobile-sale-metric">
          <span>Buying cost</span>
          <strong>${formatMoney(cost)}</strong>
        </div>
      </div>

      <div class="mobile-sale-bottom">
        <span class="cell-sub">Sale record</span>
        <button class="delete-sale" type="button" data-delete-id="${escapeHTML(sale.id)}">
          Delete sale
        </button>
      </div>
    `;

    salesMobileList.appendChild(card);
  }
}

// ---------------------------------------------------------
// DELETE A SALE
// ---------------------------------------------------------

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-id]");

  if (!button) return;

  const saleId = button.dataset.deleteId;

  if (!currentUser || !saleId) return;

  const sale = sales.find((item) => item.id === saleId);

  if (!sale) {
    showToast("This sale could not be found.");
    return;
  }

  const confirmed = window.confirm(
    `Delete the sale for "${sale.productName || "this product"}"?\n\n` +
    "This removes the sales record and changes the totals shown on this page. It cannot be undone."
  );

  if (!confirmed) return;

  button.disabled = true;

  try {
    await deleteDoc(
      doc(db, "users", currentUser.uid, "sales", saleId)
    );

    showToast("Sale deleted.");
  } catch (error) {
    console.error("Deleting sale failed:", error);

    showToast(
      error.code === "permission-denied"
        ? "Firebase rules do not allow deleting this sale."
        : "Could not delete this sale. Please try again."
    );

    button.disabled = false;
  }
});

// ---------------------------------------------------------
// CLEAR FORM
// ---------------------------------------------------------

resetButton.addEventListener("click", () => {
  setTimeout(() => {
    hideAlert();
    setFormDefaults();
    updateCalculation();
  }, 0);
});

// ---------------------------------------------------------
// LOG OUT
// ---------------------------------------------------------

logoutButton.addEventListener("click", async () => {
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
    if (stopProductsListener) stopProductsListener();
    if (stopSalesListener) stopSalesListener();

    window.location.href = "./login.html";
    return;
  }

  if (currentUser?.uid === user.uid) return;

  if (stopProductsListener) stopProductsListener();
  if (stopSalesListener) stopSalesListener();

  currentUser = user;

  startProductsListener();
  startSalesListener();
});

setFormDefaults();
updateCalculation();
