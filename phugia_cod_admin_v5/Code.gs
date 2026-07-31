/**
 * PHÚ GIA DIAMOND COD SYSTEM V5
 * Landing Page + Admin Web + Google Sheet + Telegram + Gmail
 *
 * Sheets:
 * - Orders: lưu đơn hàng
 * - Config: lưu cấu hình landing page
 *
 * Web API:
 * GET  ?action=config                  -> Landing page lấy cấu hình công khai
 * GET  ?action=adminConfig&key=...      -> Admin lấy cấu hình đầy đủ
 * GET  ?action=orders&key=...           -> Admin xem đơn
 * POST {action:"saveConfig",key,config} -> Admin lưu cấu hình
 * POST đơn hàng từ landing page         -> Lưu đơn + gửi Telegram/Gmail
 */

const SHEET_ORDERS = "Orders";
const SHEET_CONFIG = "Config";

function doGet(e) {
  const action = e.parameter.action || "";

  if (action === "config") {
    return json_({ ok: true, config: getPublicConfig_() });
  }

  if (action === "adminConfig") {
    checkAdmin_(e.parameter.key);
    return json_({ ok: true, config: getConfig_() });
  }

  if (action === "orders") {
    checkAdmin_(e.parameter.key);
    return json_({ ok: true, orders: getOrders_() });
  }

  return HtmlService.createHtmlOutput("Phú Gia Diamond API is running.");
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");

    if (data.action === "saveConfig") {
      checkAdmin_(data.key);
      saveConfig_(data.config || {});
      savePrivateProps_(data.config || {});
      return json_({ ok: true });
    }

    return handleOrder_(data);
  } catch (err) {
    return json_({ ok: false, error: err.toString() });
  }
}

function handleOrder_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateOrdersSheet_(ss);
    const config = getConfig_();
    const stockResult = updatePriceTableStock_(data, config);

    const orderId = "PGD-" + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyyMMdd-HHmmss");
    const createdAt = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

    const fullAddress = [data.address, data.ward, data.district, data.province].filter(Boolean).join(", ");
    const mapsLink = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);

    const productName = data.product || config.productName || "";
    const price = stockResult.price || data.price || config.salePrice || "";

    sheet.appendRow([
      createdAt, orderId, productName, data.name || "", data.phone || "",
      data.address || "", data.province || "", data.district || "", data.ward || "",
      data.variant || "", data.size || "", data.quantity || "", data.combo || "", data.payment || "",
      price, data.note || "", data.source || "", mapsLink, "Mới"
    ]);

    const message =
`💎 ĐƠN HÀNG MỚI - PHÚ GIA DIAMOND
🧾 Mã đơn: ${orderId}
👤 Khách: ${data.name || ""}
📞 SĐT: ${data.phone || ""}
📍 Địa chỉ: ${fullAddress}
🗺 Google Maps: ${mapsLink}
💍 Sản phẩm: ${productName}
📦 Phân loại: ${data.variant || ""}
📏 Size: ${data.size || ""}
🔢 Số lượng: ${data.quantity || ""}
🎁 Combo: ${data.combo || ""}
💳 Thanh toán: ${data.payment || ""}
💰 Giá: ${formatMoney_(price)}đ
📦 Kho còn lại: ${stockResult.stockLeft}
🏦 CK: ${config.bankName || ""} - ${config.bankAccount || ""} - ${config.bankOwner || ""}
📝 Ghi chú: ${data.note || "Không có"}
🕒 Thời gian: ${createdAt}`;

    sendTelegram_(message);
    sendGmail_(orderId, message);

    return json_({ ok: true, orderId });
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateOrdersSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ORDERS);
    sheet.appendRow([
      "Thời gian","Mã đơn","Sản phẩm","Họ tên","Số điện thoại","Địa chỉ",
      "Tỉnh/TP","Quận/Huyện","Phường/Xã","Phân loại","Size","Số lượng","Combo",
      "Thanh toán","Giá","Ghi chú","Nguồn","Google Maps","Trạng thái"
    ]);
    sheet.getRange(1,1,1,19).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < 19) {
    sheet.getRange(1,1,1,19).setValues([[
      "Thời gian","Mã đơn","Sản phẩm","Họ tên","Số điện thoại","Địa chỉ",
      "Tỉnh/TP","Quận/Huyện","Phường/Xã","Phân loại","Size","Số lượng","Combo",
      "Thanh toán","Giá","Ghi chú","Nguồn","Google Maps","Trạng thái"
    ]]);
    sheet.getRange(1,1,1,19).setFontWeight("bold");
  }
  return sheet;
}

function getOrCreateConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CONFIG);
    sheet.appendRow(["key", "value"]);
    const defaults = defaultConfig_();
    Object.keys(defaults).forEach(k => sheet.appendRow([k, defaults[k]]));
    sheet.getRange(1,1,1,2).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function defaultConfig_() {
  return {
    productName: "Bông nụ bạc S925 kim cương Moissanite cao cấp full kiểm định GRA",
    shopName: "Phú Gia Diamond",
    salePrice: "459999",
    oldPrice: "647895",
    discountText: "Flash Sale",
    flashMinutes: "14",
    soldCount: "1238",
    stockLeft: "17",
    shortDescription: "Bạc thật S925, Moissanite sáng đẹp, full kiểm định GRA, tặng hộp cao cấp.",
    bankName: "",
    bankAccount: "",
    bankOwner: "",
    bankContent: "PGD + Số điện thoại",
    bankInfo: "Chuyển khoản theo nội dung: PGD + Số điện thoại.",
    shopAddress: "",
    hotline: "",
    zalo: "",
    shopMap: "",
    sizes: "4mm,4.5mm,5mm,6mm,6.8mm,7.5mm",
    quantities: "1 đôi,2 đôi,3 đôi",
    combos: "Mua 1 đôi: giá theo size + Freeship\nMua 1 chiếc: giá theo size",
    priceTable: `[
  {"type":"1 Chiếc","size":"4mm","code":"MS04","stock":"106","oldPrice":"295000","salePrice":"229999"},
  {"type":"1 Chiếc","size":"4.5mm","code":"MS04.5","stock":"2","oldPrice":"315000","salePrice":"249000"},
  {"type":"1 Chiếc","size":"5mm","code":"MS05","stock":"105","oldPrice":"332000","salePrice":"259000"},
  {"type":"1 Chiếc","size":"6mm","code":"MS06","stock":"50","oldPrice":"444000","salePrice":"305999"},
  {"type":"1 Chiếc","size":"6.8mm","code":"MS06.8","stock":"31","oldPrice":"556000","salePrice":""},
  {"type":"1 Chiếc","size":"7.5mm","code":"MS07.5","stock":"41","oldPrice":"700000","salePrice":"409999"},
  {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"600303","salePrice":"399999"},
  {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"3","oldPrice":"616216","salePrice":"439999"},
  {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"647895","salePrice":"459999"},
  {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"804872","salePrice":"549999"},
  {"type":"1 Đôi","size":"6.8mm","code":"MS06.8*2","stock":"6","oldPrice":"953721","salePrice":"659999"},
  {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"1204000","salePrice":"759999"}
]`,
    policies: "Được kiểm tra hàng trước khi thanh toán\nCam kết bạc thật S925\nBảo hành đánh bóng, làm sáng sản phẩm\nHỗ trợ tư vấn chọn size phù hợp"
  };
}

function getConfig_() {
  const sheet = getOrCreateConfigSheet_();
  const values = sheet.getDataRange().getValues();
  const config = defaultConfig_();

  for (let i = 1; i < values.length; i++) {
    const key = values[i][0];
    const value = values[i][1];
    if (key) config[key] = value;
  }

  return config;
}

function getPublicConfig_() {
  const cfg = getConfig_();
  delete cfg.telegramBotToken;
  delete cfg.telegramChatId;
  delete cfg.adminEmail;
  delete cfg.newAdminKey;
  return cfg;
}

function saveConfig_(config) {
  const sheet = getOrCreateConfigSheet_();
  sheet.clear();
  sheet.appendRow(["key", "value"]);

  const all = Object.assign(defaultConfig_(), config);
  const privateKeys = ["telegramBotToken", "telegramChatId", "adminEmail", "newAdminKey"];

  Object.keys(all).forEach(k => {
    if (privateKeys.indexOf(k) === -1) {
      sheet.appendRow([k, all[k]]);
    }
  });

  sheet.getRange(1,1,1,2).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function updateConfigValue_(key, value) {
  const sheet = getOrCreateConfigSheet_();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  sheet.appendRow([key, value]);
}

function parsePriceTable_(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function updatePriceTableStock_(data, config) {
  const table = parsePriceTable_(config.priceTable);
  const variant = String(data.variant || "").trim();
  const size = String(data.size || "").trim();
  const quantity = Math.max(1, Number(data.quantity || 1));
  const item = table.find(row => String(row.type || "").trim() === variant && String(row.size || "").trim() === size);

  if (!item) {
    return { price: data.price || config.salePrice || "", stockLeft: "Không theo dõi" };
  }

  const price = item.salePrice || item.oldPrice || data.price || config.salePrice || "";
  const currentStock = Number(String(item.stock || "").replace(/\D/g, ""));

  if (!Number.isFinite(currentStock) || item.stock === "") {
    return { price, stockLeft: "Không theo dõi" };
  }

  if (currentStock < quantity) {
    throw new Error("Sản phẩm " + variant + " - " + size + " chỉ còn " + currentStock + ", không đủ số lượng khách đặt");
  }

  item.stock = String(currentStock - quantity);
  updateConfigValue_("priceTable", JSON.stringify(table, null, 2));

  return { price, stockLeft: item.stock };
}

function savePrivateProps_(config) {
  const props = PropertiesService.getScriptProperties();

  if (config.telegramBotToken) props.setProperty("TELEGRAM_BOT_TOKEN", config.telegramBotToken);
  if (config.telegramChatId) props.setProperty("TELEGRAM_CHAT_ID", config.telegramChatId);
  if (config.adminEmail) props.setProperty("ADMIN_EMAIL", config.adminEmail);
  if (config.newAdminKey) props.setProperty("ADMIN_KEY", config.newAdminKey);
}

function checkAdmin_(key) {
  const props = PropertiesService.getScriptProperties();
  let adminKey = props.getProperty("ADMIN_KEY");

  if (!adminKey) {
    adminKey = "123456";
    props.setProperty("ADMIN_KEY", adminKey);
  }

  if (String(key || "") !== String(adminKey)) {
    throw new Error("Sai mật khẩu admin");
  }
}

function getOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = Math.max(1, values.length - 50); i < values.length; i++) {
    const r = values[i];
    const hasVariantColumn = r[9] === "1 Chiếc" || r[9] === "1 Đôi";
    rows.unshift({
      createdAt: r[0],
      orderId: r[1],
      product: r[2],
      name: r[3],
      phone: r[4],
      address: [r[5], r[8], r[7], r[6]].filter(Boolean).join(", "),
      variant: hasVariantColumn ? r[9] : "",
      size: hasVariantColumn ? r[10] : r[9],
      quantity: hasVariantColumn ? r[11] : r[10],
      status: hasVariantColumn ? r[18] : r[17]
    });
  }

  return rows;
}

function sendTelegram_(text) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("TELEGRAM_BOT_TOKEN");
  const chatId = props.getProperty("TELEGRAM_CHAT_ID");

  if (!token || !chatId) return;

  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId, text }),
    muteHttpExceptions: true
  });
}

function sendGmail_(orderId, text) {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty("ADMIN_EMAIL");

  if (!email) return;
  GmailApp.sendEmail(email, "Đơn hàng mới " + orderId + " - Phú Gia Diamond", text);
}

function formatMoney_(value) {
  const n = Number(String(value || 0).replace(/\D/g, ""));
  return n.toLocaleString("vi-VN");
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
