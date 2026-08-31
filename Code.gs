/**
 * =========================================================================
 * PHÚ GIA DIAMOND - CHUYÊN BIỆT THỊ TRƯỜNG ĐÀI LOAN (NT$)
 * Backend Google Apps Script Độc Lập - Quản lý Google Sheet, Drive & Telegram TW
 * =========================================================================
 */

const SHEET_ORDERS = "Orders";
const SHEET_CONFIG = "Config";

/**
 * HÀM CẤP QUYỀN GOOGLE DRIVE VÀ TẠO THƯ MỤC LƯU ẢNH THẺ CƯ TRÚ (ARC)
 * 👉 Hãy chọn hàm này và bấm nút "Chạy" (Run) 1 lần trên Google Apps Script để cấp quyền Drive!
 */
function capQuyenGoogleDriveVaTaoThuMuc() {
  const folderName = "PhuGia_TheCuTru_TW";
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
  }
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {}
  Logger.log("✅ Đã cấp quyền Google Drive thành công! Thư mục lưu ảnh ARC: " + folder.getUrl());
  return folder.getUrl();
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  if (action === "config") {
    return json_({ ok: true, config: getPublicConfigTW_() });
  }
  return HtmlService.createHtmlOutput(
    "<div style='font-family:sans-serif;text-align:center;padding:50px;'>" +
    "<h2>Phú Gia Diamond - Taiwan API is running securely.</h2>" +
    "<p>Hệ thống tiếp nhận đơn hàng Đài Loan & lưu ảnh Thẻ Cư Trú (ARC) hoạt động 24/7.</p>" +
    "</div>"
  );
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");

    // 1. Admin lấy cấu hình
    if (data.action === "adminConfig") {
      checkAdminWithBruteForceGuard_(data.key);
      return json_({ ok: true, config: getConfig_() });
    }

    // 2. Admin xem đơn hàng
    if (data.action === "orders") {
      checkAdminWithBruteForceGuard_(data.key);
      return json_({ ok: true, orders: getOrders_() });
    }

    // 3. Admin lưu cấu hình
    if (data.action === "saveConfig") {
      checkAdminWithBruteForceGuard_(data.key);
      saveConfig_(data.config || {});
      savePrivateProps_(data.config || {});
      return json_({ ok: true });
    }

    // 4. Khách đặt hàng từ Landing Page Đài Loan
    return handleOrderTW_(data);
  } catch (err) {
    return json_({ ok: false, error: err.message || err.toString() });
  }
}

function handleOrderTW_(data) {
  const rawPhone = String(data.phone || "").replace(/[\s\-\.]/g, "");
  const twPhoneRegex = /^(09[0-9]{8}|(\+?8869)[0-9]{8})$/;

  if (!twPhoneRegex.test(rawPhone)) {
    return json_({ ok: false, error: "Số điện thoại Đài Loan không đúng định dạng (09xxxxxxxx gồm 10 số)." });
  }

  const rawName = String(data.name || "").trim();
  if (!rawName || rawName.length < 2) {
    return json_({ ok: false, error: "Vui lòng nhập họ tên người nhận đầy đủ." });
  }

  // Chống Spam theo SĐT (30 giây)
  const cache = CacheService.getScriptCache();
  const cacheKey = "rate_limit_tw_" + rawPhone;
  if (cache.get(cacheKey)) {
    return json_({ ok: false, error: "Bạn vừa gửi đơn hàng cách đây ít giây. Shop sẽ liên hệ xác nhận sớm!" });
  }
  cache.put(cacheKey, "submitted", 30);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateOrdersSheet_(ss);
    const config = getConfig_();

    // Lưu ảnh Thẻ Cư Trú / Card xưởng vào Google Drive nếu có
    const arcImageUrl = saveImageToDrive_(data.arcImage, rawPhone);

    // Tính giá và trừ kho an toàn ở server
    const stockResult = updateStockTW_(data, config);
    const orderId = "PGD-TW-" + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyyMMdd-HHmmss");
    const createdAt = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

    const fullAddress = [data.address, data.province]
      .map(cleanText_)
      .filter(Boolean)
      .join(", ");
    const mapsLink = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);

    const productName = cleanText_(data.product || config.productName || "Bông nụ bạc S925 Moissanite (4 Chấu) - Đài Loan");
    const priceRaw = stockResult.price || config.salePrice || "1114";
    const priceFormatted = `NT$ ${formatMoney_(priceRaw)}`;

    // Ghi an toàn vào Google Sheet
    sheet.appendRow([
      createdAt,
      orderId,
      productName,
      cleanText_(data.name || ""),
      cleanText_(data.phone || ""),
      cleanText_(data.address || ""),
      cleanText_(data.province || ""),
      cleanText_(data.variant || "1 Đôi"),
      cleanText_(data.size || "5mm"),
      cleanText_(data.quantity || "1"),
      cleanText_(data.combo || ""),
      cleanText_(data.payment || "COD nhận hàng trả tiền (NT$)"),
      priceFormatted,
      cleanText_(data.note || ""),
      arcImageUrl || "Không tải lên",
      mapsLink,
      "Mới"
    ]);

    // Bắn tin nhắn Telegram & Gmail
    const arcText = arcImageUrl ? `\n🪪 Ảnh Thẻ Cư Trú (ARC): ${arcImageUrl}` : "";
    const message =
`💎 🇹🇼 ĐƠN HÀNG MỚI TẠI ĐÀI LOAN - PHÚ GIA DIAMOND
🧾 Mã đơn: ${orderId}
👤 Khách hàng: ${cleanText_(data.name || "")}
📞 Số điện thoại: ${cleanText_(data.phone || "")} (Đài Loan 🇹🇼)
📍 Địa chỉ giao: ${fullAddress}${arcText}
🗺 Google Maps: ${mapsLink}
💍 Sản phẩm: ${productName}
📦 Quy cách: ${cleanText_(data.variant || "1 Đôi")} (Size ${cleanText_(data.size || "5mm")} - 4 Chấu)
🔢 Số lượng: ${cleanText_(data.quantity || "1")} đôi
🎁 Combo: ${cleanText_(data.combo || "Hỗ trợ giao tại Đài Loan")}
💳 Thanh toán: ${cleanText_(data.payment || "COD nhận hàng trả tiền NT$")}
💰 Tổng thanh toán: ${priceFormatted}
📦 Kho còn: ${stockResult.stockLeft}
📝 Ghi chú: ${cleanText_(data.note || "Không có")}
🕒 Thời gian: ${createdAt}`;

    safeSendTelegram_(message);
    safeSendGmail_(orderId, message);

    return json_({ ok: true, orderId, market: "Đài Loan (NT$)", arcImageUrl: arcImageUrl || null });
  } finally {
    lock.releaseLock();
  }
}

function saveImageToDrive_(base64Data, phone) {
  if (!base64Data || typeof base64Data !== "string" || !base64Data.includes("base64,")) {
    return "";
  }
  try {
    const parts = base64Data.split("base64,");
    const base64Clean = parts[1];
    const decoded = Utilities.base64Decode(base64Clean);
    const now = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyyMMdd_HHmmss");
    const blob = Utilities.newBlob(decoded, "image/jpeg", "ARC_" + phone + "_" + now + ".jpg");

    const folderName = "PhuGia_TheCuTru_TW";
    let folder;
    const folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }

    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    return file.getUrl();
  } catch (err) {
    console.log("Lỗi lưu ảnh Google Drive: " + err.toString());
    return "";
  }
}

function getOrCreateOrdersSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_ORDERS);
  const headers = [
    "Thời gian","Mã đơn","Sản phẩm","Họ tên","Số điện thoại","Địa chỉ",
    "Khu vực","Quy cách","Size đá (4 chấu)","Số lượng","Combo",
    "Thanh toán","Tổng tiền NT$","Ghi chú","Ảnh Thẻ Cư Trú (ARC)","Google Maps","Trạng thái"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ORDERS);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CONFIG);
    sheet.appendRow(["key", "value"]);
    const defaults = defaultConfigTW_();
    Object.keys(defaults).forEach(k => sheet.appendRow([k, defaults[k]]));
    sheet.getRange(1,1,1,2).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function defaultConfigTW_() {
  return {
    shopName: "Phú Gia Diamond (Đài Loan)",
    productName: "Bông nụ bạc S925 Moissanite cao cấp (4 Chấu) - giao tại Đài Loan",
    salePrice: "1114",
    oldPrice: "1590",
    discountText: "Flash Sale",
    stockLeft: "23",
    soldCount: "865",
    shortDescription: "Bạc thật S925, Moissanite sáng đẹp, full kiểm định GRA quốc tế, hỗ trợ giao tận tay tại Đài Loan.",
    priceTable: `[
  {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"1590","salePrice":"1114"},
  {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"12","oldPrice":"1690","salePrice":"1175"},
  {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"1990","salePrice":"1406"},
  {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"2350","salePrice":"1652"},
  {"type":"1 Đôi","size":"7mm","code":"MS07*2","stock":"18","oldPrice":"3390","salePrice":"2403"},
  {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"3990","salePrice":"2804"}
]`,
    shopAddress: "Đài Loan & Việt Nam",
    hotline: "09xxxxxxxx",
    zalo: "0398138678"
  };
}

function getConfig_() {
  const sheet = getOrCreateConfigSheet_();
  const values = sheet.getDataRange().getValues();
  const config = defaultConfigTW_();

  for (let i = 1; i < values.length; i++) {
    const key = values[i][0];
    const value = values[i][1];
    if (key) config[key] = value;
  }
  return config;
}

function getPublicConfigTW_() {
  const cfg = getConfig_();
  return {
    market: "TW",
    currency: "TWD",
    currencySymbol: "NT$",
    shopName: cfg.shopName || "Phú Gia Diamond",
    productName: cfg.productName || "Bông nụ bạc S925 Moissanite - Đài Loan",
    salePrice: cfg.salePrice || "1114",
    oldPrice: cfg.oldPrice || "1590",
    discountText: cfg.discountText || "Flash Sale",
    stockLeft: cfg.stockLeft || "23",
    soldCount: cfg.soldCount || "865",
    priceTable: parsePriceTable_(cfg.priceTable),
    hotline: cfg.hotline || "",
    zalo: cfg.zalo || "0398138678"
  };
}

function saveConfig_(config) {
  const sheet = getOrCreateConfigSheet_();
  sheet.clear();
  sheet.appendRow(["key", "value"]);

  const all = Object.assign(defaultConfigTW_(), config);
  const privateKeys = ["telegramBotToken", "telegramChatId", "adminEmail", "newAdminKey"];

  Object.keys(all).forEach(k => {
    if (privateKeys.indexOf(k) === -1) {
      sheet.appendRow([k, all[k]]);
    }
  });

  sheet.getRange(1,1,1,2).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function updateStockTW_(data, config) {
  const table = parsePriceTable_(config.priceTable);
  const variant = String(data.variant || "1 Đôi").trim();
  const size = String(data.size || "5mm").trim();
  const quantity = Math.max(1, Number(data.quantity || 1));
  const item = table.find(row => String(row.type || "").trim() === variant && String(row.size || "").trim() === size);

  if (!item) {
    return { price: config.salePrice || "1114", stockLeft: "Không theo dõi" };
  }

  const price = item.salePrice || item.oldPrice || config.salePrice || "1114";
  const currentStock = Number(String(item.stock || "").replace(/\D/g, ""));

  if (!Number.isFinite(currentStock) || item.stock === "") {
    return { price, stockLeft: "Không theo dõi" };
  }

  if (currentStock < quantity) {
    throw new Error("Sản phẩm size " + size + " tại Đài Loan chỉ còn " + currentStock + ", không đủ số lượng đặt");
  }

  item.stock = String(currentStock - quantity);
  updateConfigSingleKey_("priceTable", JSON.stringify(table, null, 2));

  return { price, stockLeft: item.stock };
}

function updateConfigSingleKey_(key, value) {
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

function savePrivateProps_(config) {
  const props = PropertiesService.getScriptProperties();
  if (config.telegramBotToken) props.setProperty("TELEGRAM_BOT_TOKEN", config.telegramBotToken.trim());
  if (config.telegramChatId) props.setProperty("TELEGRAM_CHAT_ID", config.telegramChatId.trim());
  if (config.adminEmail) props.setProperty("ADMIN_EMAIL", config.adminEmail.trim());
  if (config.newAdminKey && config.newAdminKey.trim()) {
    props.setProperty("ADMIN_KEY", config.newAdminKey.trim());
  }
}

function checkAdminWithBruteForceGuard_(key) {
  const cache = CacheService.getScriptCache();
  const failCountKey = "admin_fail_attempts_tw";
  const lockKey = "admin_lockout_active_tw";

  if (cache.get(lockKey)) {
    throw new Error("Tài khoản admin đang bị tạm khóa 10 phút do nhập sai mật khẩu quá 5 lần.");
  }

  const props = PropertiesService.getScriptProperties();
  let adminKey = props.getProperty("ADMIN_KEY");
  if (!adminKey) {
    adminKey = "123456";
    props.setProperty("ADMIN_KEY", adminKey);
  }

  if (!key || String(key).trim() !== String(adminKey).trim()) {
    let fails = Number(cache.get(failCountKey) || 0) + 1;
    if (fails >= 5) {
      cache.put(lockKey, "locked", 600);
      cache.remove(failCountKey);
      throw new Error("Sai mật khẩu quá 5 lần. Hệ thống đã khóa truy cập Admin trong 10 phút.");
    } else {
      cache.put(failCountKey, String(fails), 300);
      throw new Error("Mật khẩu admin không chính xác (Sai " + fails + "/5 lần).");
    }
  }
  cache.remove(failCountKey);
}

function getOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = Math.max(1, values.length - 80); i < values.length; i++) {
    const r = values[i];
    rows.unshift({
      createdAt: r[0],
      orderId: r[1],
      product: r[2],
      name: r[3],
      phone: r[4],
      address: [r[5], r[6]].filter(Boolean).join(", "),
      variant: r[7] || "1 Đôi",
      size: r[8] || "",
      quantity: r[9] || "",
      price: r[12] || "",
      arcImage: r[14] || "",
      status: r[16] || "Mới"
    });
  }
  return rows;
}

function safeSendTelegram_(text) {
  try {
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
  } catch (e) {}
}

function safeSendGmail_(orderId, text) {
  try {
    const props = PropertiesService.getScriptProperties();
    const email = props.getProperty("ADMIN_EMAIL");
    if (!email) return;
    GmailApp.sendEmail(email, "Đơn hàng mới Đài Loan " + orderId + " - Phú Gia Diamond", text);
  } catch (e) {}
}

function formatMoney_(value) {
  const n = Number(String(value || 0).replace(/\D/g, ""));
  return n.toLocaleString("zh-TW");
}

function cleanText_(value) {
  if (value === null || value === undefined) return "";
  let str = String(value).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return str;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
