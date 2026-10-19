
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const form = $("product-form");
const nameInput = $("product-name");
const costInput = $("buying-cost");
const submitButton = $("product-submit");
const cancelButton = $("cancel-edit");
const formHeading = $("form-heading");
const tableBody = $("products-table-body");
const mobileList = $("products-mobile-list");
const searchInput = $("product-search");
const sortSelect = $("product-sort");
const toastElement = $("toast");

let currentUser = null;
let products = [];
let editingId = null;
let unsubscribeProducts = null;
let busy = false;
let toastTimer = null;

$("current-year").textContent = new Date().getFullYear();

function money(value) {
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showToast(message, type = "success") {
  clearTimeout(toastTimer);

  toastElement.textContent = message;
  toastElement.className = `toast show ${type}`;

  toastTimer = setTimeout(() => {
    toastElement.className = "toast";
  }, 4500);
}

function setSyncStatus(message) {
  $("sync-status").textContent = message;
}

function setBusy(value) {
  busy = value;
  submitButton.disabled = value;
  cancelButton.disabled = value;

  submitButton.innerHTML = value
    ? '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Please wait...</span>'
    : editingId
      ? '<i class="fa-solid fa-floppy-disk"></i><span>Update product</span>'
      : '<i class="fa-solid fa-plus"></i><span>Save product</span>';
}

function resetForm() {
  form.reset();
  editingId = null;

  formHeading.textContent = "Add a product";
  cancelButton.classList.add("hidden");

  setBusy(false);
}

function formatDate(timestamp) {
  if (!timestamp) return "Recently added";

  const date = typeof timestamp.toDate === "function"
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "Recently added";

  return `Added ${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  })}`;
}

function getVisibleProducts() {
  const query = searchInput.value.trim().toLowerCase();
  const sort = sortSelect.value;

  const visible = products.filter((product) =>
    product.name.toLowerCase().includes(query)
  );

  visible.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;

    switch (sort) {
      case "oldest":
        return aTime - bTime;
      case "name":
        return a.name.localeCompare(b.name);
      case "cost-high":
        return b.buyingCost - a.buyingCost;
      case "cost-low":
        return a.buyingCost - b.buyingCost;
      case "newest":
      default:
        return bTime - aTime;
    }
  });

  return visible;
}

function renderProducts() {
  const visible = getVisibleProducts();

  $("total-products").textContent = products.length;
  $("total-cost").textContent = money(
    products.reduce((total, product) => total + product.buyingCost, 0)
  );

  $("products-count").textContent = visible.length;
  $("products-count-label").textContent =
    `${visible.length} ${visible.length === 1 ? "product" : "products"} shown`;

  if (visible.length === 0) {
    const isSearching = searchInput.value.trim().length > 0;

    const emptyHTML = `
      <div class="empty-state">
        <i class="fa-solid ${isSearching ? "fa-magnifying-glass" : "fa-box-open"}"></i>
        <strong>${isSearching ? "No matching products" : "Your catalogue is empty"}</strong>
        <span>${isSearching
          ? "Try a different product name."
          : "Add your first finished product using the form."}</span>
      </div>
    `;

    tableBody.innerHTML = `
      <tr><td colspan="3">${emptyHTML}</td></tr>
    `;

    mobileList.innerHTML = emptyHTML;
    return;
  }

  tableBody.innerHTML = visible.map((product) => {
    const initial = escapeHTML(
      product.name.trim().charAt(0).toUpperCase() || "P"
    );

    return `
      <tr>
        <td>
          <div class="product-name-cell">
            <span class="product-avatar">${initial}</span>
            <div>
              <div class="product-name-text">${escapeHTML(product.name)}</div>
              <span class="product-subtitle">${escapeHTML(formatDate(product.createdAt))}</span>
            </div>
          </div>
        </td>
        <td class="cost-cell">${money(product.buyingCost)}</td>
        <td>
          <div class="product-actions">
            <button type="button" class="action-button"
              data-action="edit" data-id="${escapeHTML(product.id)}"
              aria-label="Edit ${escapeHTML(product.name)}"
              title="Edit product">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button type="button" class="action-button delete"
              data-action="delete" data-id="${escapeHTML(product.id)}"
              aria-label="Delete ${escapeHTML(product.name)}"
              title="Delete product">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  mobileList.innerHTML = visible.map((product) => {
    const initial = escapeHTML(
      product.name.trim().charAt(0).toUpperCase() || "P"
    );

    return `
      <article class="product-mobile-card">
        <span class="product-avatar">${initial}</span>
        <div class="product-mobile-main">
          <div class="product-mobile-name">${escapeHTML(product.name)}</div>
          <div class="product-mobile-cost">${money(product.buyingCost)}</div>
          <div class="product-mobile-label">${escapeHTML(formatDate(product.createdAt))}</div>
        </div>
        <div class="product-actions">
          <button type="button" class="action-button"
            data-action="edit" data-id="${escapeHTML(product.id)}"
            aria-label="Edit product" title="Edit">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="action-button delete"
            data-action="delete" data-id="${escapeHTML(product.id)}"
            aria-label="Delete product" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function startProductListener(user) {
  if (unsubscribeProducts) {
    unsubscribeProducts();
    unsubscribeProducts = null;
  }

  products = [];
  renderProducts();
  setSyncStatus("Loading your products...");

  const productsRef = collection(db, "users", user.uid, "products");

  unsubscribeProducts = onSnapshot(
    productsRef,
    (snapshot) => {
      products = snapshot.docs.map((item) => {
        const data = item.data();

        return {
          id: item.id,
          name: String(data.name ?? ""),
          buyingCost: Number(data.buyingCost ?? 0),
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null
        };
      });

      renderProducts();
      setSyncStatus("Cloud sync is active");
    },
    (error) => {
      console.error("Products Firestore listener failed:", error);
      setSyncStatus("Cloud sync failed");

      if (error.code === "permission-denied") {
        showToast(
          "Firestore denied access. Check your Firestore Security Rules.",
          "error"
        );
      } else {
        showToast(
          `Could not load products: ${error.message}`,
          "error"
        );
      }
    }
  );
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showToast("Please sign in before saving products.", "error");
    return;
  }

  if (busy) return;

  const name = nameInput.value.trim();
  const buyingCost = Number(costInput.value);

  if (!name) {
    showToast("Enter a product name.", "error");
    nameInput.focus();
    return;
  }

  if (
    costInput.value.trim() === "" ||
    !Number.isFinite(buyingCost) ||
    buyingCost < 0
  ) {
    showToast("Enter a valid buying cost of zero or more.", "error");
    costInput.focus();
    return;
  }

  setBusy(true);

  try {
    if (editingId) {
      const productRef = doc(
        db,
        "users",
        currentUser.uid,
        "products",
        editingId
      );

      await updateDoc(productRef, {
        name,
        buyingCost,
        updatedAt: serverTimestamp()
      });

      showToast("Product updated successfully.");
    } else {
      const productsRef = collection(
        db,
        "users",
        currentUser.uid,
        "products"
      );

      await addDoc(productsRef, {
        name,
        buyingCost,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showToast("Product saved to Firestore successfully.");
    }

    resetForm();
  } catch (error) {
    console.error("Could not save product:", error);

    if (error.code === "permission-denied") {
      showToast(
        "Permission denied. Check the Firestore Security Rules below.",
        "error"
      );
    } else if (error.code === "unavailable") {
      showToast(
        "Firebase is temporarily unavailable. Check your internet connection and try again.",
        "error"
      );
    } else {
      showToast(`Save failed: ${error.message}`, "error");
    }
  } finally {
    setBusy(false);
  }
});

function startEditing(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;

  editingId = product.id;
  nameInput.value = product.name;
  costInput.value = product.buyingCost;

  formHeading.textContent = "Edit product";
  cancelButton.classList.remove("hidden");

  setBusy(false);
  submitButton.innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i><span>Update product</span>';

  form.scrollIntoView({ behavior: "smooth", block: "start" });
  nameInput.focus({ preventScroll: true });
}

async function removeProduct(productId) {
  if (!currentUser) {
    showToast("Please sign in first.", "error");
    return;
  }

  const product = products.find((item) => item.id === productId);
  if (!product) return;

  const confirmed = window.confirm(
    `Delete "${product.name}" from your catalogue?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    const productRef = doc(
      db,
      "users",
      currentUser.uid,
      "products",
      productId
    );

    await deleteDoc(productRef);

    if (editingId === productId) resetForm();

    showToast("Product deleted.");
  } catch (error) {
    console.error("Could not delete product:", error);

    showToast(
      error.code === "permission-denied"
        ? "You do not have permission to delete this product. Check Firestore rules."
        : `Delete failed: ${error.message}`,
      "error"
    );
  }
}

function handleProductAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const productId = button.dataset.id;
  const action = button.dataset.action;

  if (action === "edit") startEditing(productId);
  if (action === "delete") removeProduct(productId);
}

tableBody.addEventListener("click", handleProductAction);
mobileList.addEventListener("click", handleProductAction);

cancelButton.addEventListener("click", resetForm);
searchInput.addEventListener("input", renderProducts);
sortSelect.addEventListener("change", renderProducts);

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!user) {
    if (unsubscribeProducts) {
      unsubscribeProducts();
      unsubscribeProducts = null;
    }

    setSyncStatus("Sign-in required");
    $("account-email").textContent = "Not signed in";

    // Assumes login.html is in the same html/ folder.
    window.location.href = "./login.html";
    return;
  }

  $("account-email").textContent = user.email || "Signed in";
  startProductListener(user);
});

$("signout-button").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "./login.html";
  } catch (error) {
    console.error("Sign out failed:", error);
    showToast(`Could not sign out: ${error.message}`, "error");
  }
});

const sidebar = $("sidebar");
const overlay = $("sidebar-overlay");

$("menu-toggle").addEventListener("click", () => {
  sidebar.classList.toggle("open");
  overlay.classList.toggle("show");
});

overlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
});

console.log("Cruz Heist Products page script loaded.");
