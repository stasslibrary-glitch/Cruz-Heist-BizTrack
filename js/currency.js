// CRUZ HEIST BIZTRACK — CURRENCY SYSTEM

export const USD_TO_UGX = 4288.44;

const STORAGE_KEY = "cruzHeistDisplayCurrency";

export function getCurrency() {
    return localStorage.getItem(STORAGE_KEY) || "UGX";
}

export function setCurrency(currency) {
    if (!["UGX", "USD"].includes(currency)) return;

    localStorage.setItem(STORAGE_KEY, currency);

    document.dispatchEvent(
        new CustomEvent("currencyChanged", {
            detail: { currency }
        })
    );
}

export function convertFromUGX(amount) {
    const value = Number(amount) || 0;

    return getCurrency() === "USD"
        ? value / USD_TO_UGX
        : value;
}

export function formatMoney(amountUGX) {
    const currency = getCurrency();
    const amount = convertFromUGX(amountUGX);

    return new Intl.NumberFormat(
        currency === "UGX" ? "en-UG" : "en-US",
        {
            style: "currency",
            currency,
            minimumFractionDigits: currency === "USD" ? 2 : 0,
            maximumFractionDigits: currency === "USD" ? 2 : 0
        }
    ).format(amount);
}

export function initCurrencySwitcher() {
    const ugxButton = document.getElementById("currencyUGX");
    const usdButton = document.getElementById("currencyUSD");

    if (!ugxButton || !usdButton) return;

    function updateSwitcher() {
        const currency = getCurrency();

        ugxButton.classList.toggle("active", currency === "UGX");
        usdButton.classList.toggle("active", currency === "USD");

        ugxButton.setAttribute(
            "aria-pressed",
            String(currency === "UGX")
        );

        usdButton.setAttribute(
            "aria-pressed",
            String(currency === "USD")
        );
    }

    ugxButton.addEventListener("click", () => {
        setCurrency("UGX");
        updateSwitcher();
    });

    usdButton.addEventListener("click", () => {
        setCurrency("USD");
        updateSwitcher();
    });

    updateSwitcher();
}