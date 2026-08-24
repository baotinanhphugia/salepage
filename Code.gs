/**
 * PHÚ GIA DIAMOND COD SYSTEM V7 - BULLETPROOF SECURITY
 * Quản lý 2 Bảng giá riêng biệt cho Việt Nam (VNĐ) & Đài Loan (NT$)
 * 
 * BẢO MẬT NÂNG CAO:
 * - Chống Brute-force mật khẩu Admin (Khóa 10 phút sau 5 lần sai)
 * - Chống Quota Crash (Lỗi Gmail/Telegram không làm mất đơn hàng)
 * - Chống Formula Injection, Chống Spam đa tầng
 * - Xác thực Regex số điện thoại VN & TW chặt chẽ ở Backend
 */

const SHEET_ORDERS = "Orders";
const SHEET_CONFIG = "Config";
const SHEET_ABANDONED = "Khach_Roi_Rat";
const SHEET_PRICES_VN = "BangGia_VN";
const SHEET_PRICES_TW = "BangGia_TW";

/**
 * HÀM CẤP QUYỀN GOOGLE DRIVE VÀ TẠO THƯ MỤC LƯU ẢNH THẺ CƯ TRÚ
 * 👉 Hãy chọn hàm này và bấm nút "Chạy" (Run) 1 lần trên Google Apps Script để Cấp Quyền Truy Cập Drive!
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
  const market = String((e && e.parameter && e.parameter.market) || "VN").toUpperCase();

  if (action === "config") {
    return json_({ ok: true, config: getPublicConfigByMarket_(market) });
  }

  return HtmlService.createHtmlOutput(
    "<div style='font-family:sans-serif;text-align:center;padding:50px;'>" +
    "<h2>Phú Gia Diamond API is running securely.</h2>" +
    "<p>Hệ thống bảo vệ đa tầng đã được kích hoạt.</p>" +
    "</div>"
  );
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const reqUser = data.username || "";
    const reqPass = data.password || data.key || "";
    const action = String(data.action || "").trim();

    // 1. Admin lấy cấu hình đầy đủ
    if (action === "adminConfig") {
      checkAdminWithBruteForceGuard_(reqUser, reqPass);
      const cfg = getConfig_();
      const props = PropertiesService.getScriptProperties();
      cfg.currentAdminUsername = props.getProperty("ADMIN_USERNAME") || "admin";
      cfg.telegramBotToken = props.getProperty("TELEGRAM_BOT_TOKEN") || "";
      cfg.telegramChatId = props.getProperty("TELEGRAM_CHAT_ID") || "";
      cfg.adminEmail = props.getProperty("ADMIN_EMAIL") || "";
      return json_({ ok: true, config: cfg });
    }

    // 2. Admin xem đơn hàng
    if (action === "orders") {
      checkAdminWithBruteForceGuard_(reqUser, reqPass);
      return json_({ ok: true, orders: getOrders_() });
    }

    // 3. Admin lưu cấu hình (CHỈ LƯU VÀO SHEET & PROPERTIES, KHÔNG BẮN ĐƠN TELEGRAM/GMAIL)
    if (action === "saveConfig") {
      checkAdminWithBruteForceGuard_(reqUser, reqPass);
      saveConfig_(data.config || {});
      savePrivateProps_(data.config || {});
      return json_({ ok: true, message: "Đã cập nhật bảng giá và cấu hình thành công." });
    }

    // 3b. Admin đổi mật khẩu trực tiếp từ màn hình đăng nhập
    if (action === "changePassword") {
      checkAdminWithBruteForceGuard_(reqUser, data.currentPassword || reqPass);
      const newPass = String(data.newPassword || "").trim();
      if (!newPass || newPass.length < 4) {
        throw new Error("Mật khẩu mới phải có ít nhất 4 ký tự.");
      }
      const props = PropertiesService.getScriptProperties();
      props.setProperty("ADMIN_KEY", newPass);
      if (data.newUsername && String(data.newUsername).trim()) {
        props.setProperty("ADMIN_USERNAME", String(data.newUsername).trim());
      }
      return json_({ ok: true, message: "Đổi mật khẩu quản trị thành công!" });
    }

    // 3c. Bắt Lead rơi rớt (Khách nhập SĐT nhưng chưa bấm Đặt hàng)
    if (action === "abandonedLead" || action === "abandoned_lead") {
      return handleAbandonedLead_(data);
    }

    // 4. Khách đặt hàng từ Landing Page (VN hoặc TW)
    // Chỉ kích hoạt khi có action là "order" hoặc có đủ họ tên và số điện thoại của khách
    if (action === "order" || action === "placeOrder" || (!action && data.phone && data.name)) {
      return handleOrder_(data);
    }

    return json_({ ok: false, error: "Action không hợp lệ: " + action });
  } catch (err) {
    return json_({ ok: false, error: err.message || err.toString() });
  }
}

function handleOrder_(data) {
  const m = String(data.market || "").toUpperCase();
  const isTaiwan = m.includes("TW") || m.includes("TAIWAN") || data.currency === "TWD" || String(data.payment || "").includes("Đài Loan") || String(data.source || "").toLowerCase().includes("taiwan");
  const rawPhone = String(data.phone || "").replace(/[\s\-\.]/g, "");
  
  // Backend Validation nghiêm ngặt theo từng quốc gia
  const vnPhoneRegex = /^(0[3|5|7|8|9]|84[3|5|7|8|9])[0-9]{8}$/;
  const twPhoneRegex = /^(09[0-9]{8}|(\+?8869)[0-9]{8})$/;

  if (isTaiwan) {
    if (!twPhoneRegex.test(rawPhone)) {
      return json_({ ok: false, error: "Số điện thoại Đài Loan không đúng định dạng (09xxxxxxxx gồm 10 số)." });
    }
  } else {
    if (!vnPhoneRegex.test(rawPhone)) {
      return json_({ ok: false, error: "Số điện thoại Việt Nam không đúng định dạng (10 số)." });
    }
  }

  const rawName = String(data.name || "").trim();
  if (!rawName || rawName.length < 2) {
    return json_({ ok: false, error: "Vui lòng nhập họ tên đầy đủ." });
  }

  // Chống Spam theo SĐT (30 giây)
  const cache = CacheService.getScriptCache();
  const cacheKey = "rate_limit_phone_" + rawPhone;
  if (cache.get(cacheKey)) {
    return json_({ ok: false, error: "Bạn vừa gửi đơn hàng cách đây ít giây. Vui lòng chờ shop liên hệ xác nhận!" });
  }
  cache.put(cacheKey, "submitted", 30);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateOrdersSheet_(ss);
    const config = getConfig_();
    
    // Tính toán giá và kho an toàn ở server
    const stockResult = isTaiwan
      ? updateTaiwanPriceTableStock_(data, config)
      : updateVietnamPriceTableStock_(data, config);

    const prefix = isTaiwan ? "PGD-TW-" : "PGD-VN-";
    const orderId = prefix + Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyyMMdd-HHmmss");
    const createdAt = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");

    const fullAddress = [data.address, data.ward, data.district, data.province]
      .map(cleanText_)
      .filter(Boolean)
      .join(", ");
    const mapsLink = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);

    const productName = cleanText_(data.product || (isTaiwan ? (config.productNameTW || "Bông nụ bạc S925 Moissanite (Đài Loan)") : (config.productNameVN || config.productName)) || "");
    const priceRaw = stockResult.price || (isTaiwan ? (config.salePriceTW || "599") : (config.salePriceVN || config.salePrice)) || "0";
    const marketLabel = isTaiwan ? "Đài Loan (NT$)" : "Việt Nam (VNĐ)";
    const priceFormatted = isTaiwan ? `NT$ ${formatMoney_(priceRaw)}` : `${formatMoney_(priceRaw)}đ`;

    const arcImageUrl = saveImageToDrive_(data.arcImage, orderId);

    // Ghi an toàn vào Google Sheet (Chống Formula Injection)
    sheet.appendRow([
      createdAt,
      orderId,
      marketLabel,
      productName,
      cleanText_(data.name || ""),
      cleanText_(data.phone || ""),
      cleanText_(data.address || ""),
      cleanText_(data.province || ""),
      cleanText_(data.district || ""),
      cleanText_(data.ward || ""),
      cleanText_(data.variant || ""),
      cleanText_(data.size || ""),
      cleanText_(data.quantity || "1"),
      cleanText_(data.combo || ""),
      cleanText_(data.payment || (isTaiwan ? "COD Đài Loan" : "COD")),
      priceFormatted,
      cleanText_(data.note || ""),
      arcImageUrl || "Không tải lên",
      mapsLink,
      "Mới"
    ]);

    // Tự động đánh dấu hoàn tất đơn trong sheet Khách Rơi Rớt (nếu có)
    updateAbandonedLeadStatus_(rawPhone, orderId);

    // Bắn tin nhắn Telegram & Gmail an toàn không bao giờ làm gián đoạn việc ghi đơn
    const flag = isTaiwan ? "🇹🇼" : "🇻🇳";
    const headerTitle = isTaiwan ? "ĐƠN HÀNG MỚI TẠI ĐÀI LOAN" : "ĐƠN HÀNG MỚI TẠI VIỆT NAM";
    const arcText = arcImageUrl ? `\n🪪 Ảnh Thẻ Cư Trú (ARC): ${arcImageUrl}` : "";

    const message =
`💎 ${flag} ${headerTitle} - PHÚ GIA DIAMOND
🧾 Mã đơn: ${orderId}
🌐 Thị trường: ${marketLabel}
👤 Khách hàng: ${cleanText_(data.name || "")}
📞 Số điện thoại: ${cleanText_(data.phone || "")} ${isTaiwan ? "(Đài Loan 🇹🇼)" : ""}
📍 Địa chỉ giao: ${fullAddress}${arcText}
🗺 Chỉ đường Maps: ${mapsLink}
💍 Sản phẩm: ${productName}
📦 Phân loại: ${cleanText_(data.variant || "")}
📏 Kích cỡ đá: ${cleanText_(data.size || "")}
🔢 Số lượng: ${cleanText_(data.quantity || "1")}
🎁 Gói combo: ${cleanText_(data.combo || "")}
💳 Thanh toán: ${cleanText_(data.payment || "COD")}
💰 Tổng thanh toán: ${priceFormatted}
📦 Kho còn lại: ${stockResult.stockLeft}
📝 Ghi chú: ${cleanText_(data.note || "Không có")}
🕒 Thời gian đặt: ${createdAt}`;

    safeSendTelegram_(message);
    safeSendGmail_(orderId, message);

    return json_({ ok: true, orderId, market: marketLabel, arcImageUrl: arcImageUrl || null });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lưu ảnh Base64 vào Google Drive và trả về đường link xem ảnh
 */
function saveImageToDrive_(base64Data, orderId) {
  if (!base64Data || typeof base64Data !== "string" || !base64Data.includes("base64,")) {
    return "";
  }
  try {
    const parts = base64Data.split("base64,");
    const base64Clean = parts[1];
    const decoded = Utilities.base64Decode(base64Clean);
    const blob = Utilities.newBlob(decoded, "image/jpeg", "ARC_" + orderId + ".jpg");

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
    console.log("Lỗi lưu ảnh thẻ cư trú lên Google Drive: " + err.toString());
    return "";
  }
}

function getOrCreateOrdersSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_ORDERS);
  const headers = [
    "Thời gian","Mã đơn","Thị trường","Sản phẩm","Họ tên","Số điện thoại","Địa chỉ",
    "Tỉnh/TP","Quận/Huyện","Phường/Xã","Phân loại","Size","Số lượng","Combo",
    "Thanh toán","Giá","Ghi chú","Ảnh Thẻ Cư Trú (ARC)","Google Maps","Trạng thái"
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
    const defaults = defaultConfig_();
    Object.keys(defaults).forEach(k => sheet.appendRow([k, defaults[k]]));
    sheet.getRange(1,1,1,2).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function defaultConfig_() {
  return {
    shopName: "Phú Gia Diamond",
    flashMinutes: "14",
    soldCountVN: "1238",
    soldCountTW: "865",
    facebookPixelId: "",
    
    // --- THỊ TRƯỜNG VIỆT NAM (VNĐ) ---
    productNameVN: "Bông nụ bạc S925 kim cương Moissanite cao cấp full kiểm định GRA",
    salePriceVN: "459999",
    oldPriceVN: "647895",
    discountTextVN: "Flash Sale",
    stockLeftVN: "17",
    shortDescriptionVN: "Bạc thật S925, Moissanite sáng đẹp, full kiểm định GRA, tặng hộp cao cấp.",
    priceTableVN: `[
  {"type":"1 Chiếc","size":"4mm","code":"MS04","stock":"106","oldPrice":"295000","salePrice":"229999"},
  {"type":"1 Chiếc","size":"4.5mm","code":"MS04.5","stock":"2","oldPrice":"315000","salePrice":"249000"},
  {"type":"1 Chiếc","size":"5mm","code":"MS05","stock":"105","oldPrice":"332000","salePrice":"259000"},
  {"type":"1 Chiếc","size":"6mm","code":"MS06","stock":"50","oldPrice":"444000","salePrice":"305999"},
  {"type":"1 Chiếc","size":"6.8mm","code":"MS06.8","stock":"31","oldPrice":"556000","salePrice":"369000"},
  {"type":"1 Chiếc","size":"7.5mm","code":"MS07.5","stock":"41","oldPrice":"700000","salePrice":"409999"},
  {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"600303","salePrice":"399999"},
  {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"3","oldPrice":"616216","salePrice":"439999"},
  {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"647895","salePrice":"459999"},
  {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"804872","salePrice":"549999"},
  {"type":"1 Đôi","size":"6.8mm","code":"MS06.8*2","stock":"6","oldPrice":"953721","salePrice":"659999"},
  {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"1204000","salePrice":"759999"}
]`,

    // --- THỊ TRƯỜNG ĐÀI LOAN (NT$) ---
    productNameTW: "Bông nụ bạc S925 Moissanite cao cấp (4 Chấu) - giao tại Đài Loan",
    salePriceTW: "1114",
    oldPriceTW: "1590",
    discountTextTW: "Flash Sale",
    stockLeftTW: "23",
    shortDescriptionTW: "Bạc thật S925, Moissanite sáng đẹp, full kiểm định GRA quốc tế, hỗ trợ giao tận tay tại Đài Loan.",
    priceTableTW: `[
  {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"1590","salePrice":"1114"},
  {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"12","oldPrice":"1690","salePrice":"1175"},
  {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"1990","salePrice":"1406"},
  {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"2350","salePrice":"1652"},
  {"type":"1 Đôi","size":"7mm","code":"MS07*2","stock":"18","oldPrice":"3390","salePrice":"2403"},
  {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"3990","salePrice":"2804"}
]`,

    bankName: "",
    bankAccount: "",
    bankOwner: "",
    bankContent: "PGD + Số điện thoại",
    bankInfo: "Chuyển khoản theo nội dung: PGD + Số điện thoại.",
    shopAddress: "Hưng Yên, Việt Nam",
    hotline: "0398138678",
    zalo: "0398138678",
    shopMap: "",
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

  // Luôn lấy bảng giá cập nhật mới nhất từ 2 sheet BangGia_VN và BangGia_TW
  try {
    const tableVN = getPriceTableFromSheet_(SHEET_PRICES_VN, defaultPriceTableVN_());
    config.priceTableVN = JSON.stringify(tableVN, null, 2);
    config.priceTable = config.priceTableVN;
  } catch(e) {}

  try {
    const tableTW = getPriceTableFromSheet_(SHEET_PRICES_TW, defaultPriceTableTW_());
    config.priceTableTW = JSON.stringify(tableTW, null, 2);
  } catch(e) {}

  return config;
}

function getPublicConfigByMarket_(market) {
  const cfg = getConfig_();
  const isTW = market === "TW" || market === "TAIWAN" || market === "TWD";

  return {
    market: isTW ? "TW" : "VN",
    currency: isTW ? "TWD" : "VND",
    currencySymbol: isTW ? "NT$" : "đ",
    shopName: cfg.shopName || "Phú Gia Diamond",
    productName: isTW ? (cfg.productNameTW || cfg.productNameVN) : (cfg.productNameVN || cfg.productName),
    salePrice: isTW ? (cfg.salePriceTW || "599") : (cfg.salePriceVN || cfg.salePrice || "459999"),
    oldPrice: isTW ? (cfg.oldPriceTW || "899") : (cfg.oldPriceVN || cfg.oldPrice || "647895"),
    discountText: isTW ? (cfg.discountTextTW || "Flash Sale") : (cfg.discountTextVN || cfg.discountText || "Flash Sale"),
    stockLeft: isTW ? (cfg.stockLeftTW || "23") : (cfg.stockLeftVN || cfg.stockLeft || "17"),
    soldCount: isTW ? (cfg.soldCountTW || "865") : (cfg.soldCountVN || cfg.soldCount || "1238"),
    priceTable: isTW ? parsePriceTable_(cfg.priceTableTW) : parsePriceTable_(cfg.priceTableVN || cfg.priceTable),
    facebookPixelId: cfg.facebookPixelId || "",
    hotline: cfg.hotline || "",
    zalo: cfg.zalo || ""
  };
}

function saveConfig_(config) {
  const sheet = getOrCreateConfigSheet_();
  sheet.clear();
  sheet.appendRow(["key", "value"]);

  const all = Object.assign(defaultConfig_(), config);
  const privateKeys = ["telegramBotToken", "telegramChatId", "adminEmail", "newAdminKey", "newAdminUsername"];

  Object.keys(all).forEach(k => {
    if (privateKeys.indexOf(k) === -1) {
      sheet.appendRow([k, typeof all[k] === "object" ? JSON.stringify(all[k]) : all[k]]);
    }
  });

  sheet.getRange(1,1,1,2).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // Lưu bảng giá sang 2 sheet BangGia_VN và BangGia_TW
  if (config.priceTableVN) {
    try {
      const arrVN = typeof config.priceTableVN === "string" ? JSON.parse(config.priceTableVN) : config.priceTableVN;
      savePriceTableToSheet_(SHEET_PRICES_VN, arrVN, defaultPriceTableVN_());
    } catch(e) {}
  }

  if (config.priceTableTW) {
    try {
      const arrTW = typeof config.priceTableTW === "string" ? JSON.parse(config.priceTableTW) : config.priceTableTW;
      savePriceTableToSheet_(SHEET_PRICES_TW, arrTW, defaultPriceTableTW_());
    } catch(e) {}
  }
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


function defaultPriceTableVN_() {
  return [
    {"type":"1 Chiếc","size":"4mm","code":"MS04","stock":"106","oldPrice":"295000","salePrice":"229999"},
    {"type":"1 Chiếc","size":"4.5mm","code":"MS04.5","stock":"2","oldPrice":"315000","salePrice":"249000"},
    {"type":"1 Chiếc","size":"5mm","code":"MS05","stock":"105","oldPrice":"332000","salePrice":"259000"},
    {"type":"1 Chiếc","size":"6mm","code":"MS06","stock":"50","oldPrice":"444000","salePrice":"305999"},
    {"type":"1 Chiếc","size":"6.8mm","code":"MS06.8","stock":"31","oldPrice":"556000","salePrice":"369000"},
    {"type":"1 Chiếc","size":"7.5mm","code":"MS07.5","stock":"41","oldPrice":"700000","salePrice":"409999"},
    {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"600303","salePrice":"399999"},
    {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"3","oldPrice":"616216","salePrice":"439999"},
    {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"647895","salePrice":"459999"},
    {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"804872","salePrice":"549999"},
    {"type":"1 Đôi","size":"6.8mm","code":"MS06.8*2","stock":"6","oldPrice":"953721","salePrice":"659999"},
    {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"1204000","salePrice":"759999"}
  ];
}

function defaultPriceTableTW_() {
  return [
    {"type":"1 Đôi","size":"4mm","code":"MS04*2","stock":"56","oldPrice":"1590","salePrice":"1114"},
    {"type":"1 Đôi","size":"4.5mm","code":"MS04.5*2","stock":"12","oldPrice":"1690","salePrice":"1175"},
    {"type":"1 Đôi","size":"5mm","code":"MS05*2","stock":"46","oldPrice":"1990","salePrice":"1406"},
    {"type":"1 Đôi","size":"6mm","code":"MS06*2","stock":"25","oldPrice":"2350","salePrice":"1652"},
    {"type":"1 Đôi","size":"7mm","code":"MS07*2","stock":"18","oldPrice":"3390","salePrice":"2403"},
    {"type":"1 Đôi","size":"7.5mm","code":"MS07.5*2","stock":"111","oldPrice":"3990","salePrice":"2804"}
  ];
}

function getOrCreatePriceSheet_(ss, sheetName, defaultArray) {
  let sheet = ss.getSheetByName(sheetName);
  const headers = ["Phân loại", "Kích cỡ đá (Size)", "Mã sản phẩm (SKU)", "Số lượng tồn kho", "Giá gốc", "Giá bán ưu đãi"];
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    defaultArray.forEach(item => {
      sheet.appendRow([item.type, item.size, item.code, item.stock, item.oldPrice, item.salePrice]);
    });
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPriceTableFromSheet_(sheetName, defaultArray) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreatePriceSheet_(ss, sheetName, defaultArray);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return defaultArray;

  const table = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0] && !r[1]) continue;
    table.push({
      type: String(r[0] || "").trim(),
      size: String(r[1] || "").trim(),
      code: String(r[2] || "").trim(),
      stock: String(r[3] !== undefined && r[3] !== null ? r[3] : "").trim(),
      oldPrice: String(r[4] !== undefined && r[4] !== null ? r[4] : "").trim(),
      salePrice: String(r[5] !== undefined && r[5] !== null ? r[5] : "").trim()
    });
  }
  return table.length ? table : defaultArray;
}

function savePriceTableToSheet_(sheetName, tableData, defaultArray) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreatePriceSheet_(ss, sheetName, defaultArray);
  sheet.clear();

  const headers = ["Phân loại", "Kích cỡ đá (Size)", "Mã sản phẩm (SKU)", "Số lượng tồn kho", "Giá gốc", "Giá bán ưu đãi"];
  sheet.appendRow(headers);

  const arr = Array.isArray(tableData) && tableData.length ? tableData : defaultArray;
  arr.forEach(item => {
    sheet.appendRow([
      item.type || "",
      item.size || "",
      item.code || "",
      item.stock !== undefined ? String(item.stock) : "",
      item.oldPrice !== undefined ? String(item.oldPrice) : "",
      item.salePrice !== undefined ? String(item.salePrice) : ""
    ]);
  });

  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function updateVietnamPriceTableStock_(data, config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreatePriceSheet_(ss, SHEET_PRICES_VN, defaultPriceTableVN_());
  const values = sheet.getDataRange().getValues();
  const variant = String(data.variant || "").trim();
  const size = String(data.size || "").trim();
  const quantity = Math.max(1, Number(data.quantity || 1));

  let foundRow = -1;
  let item = null;

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[0] || "").trim() === variant && String(r[1] || "").trim() === size) {
      foundRow = i + 1;
      item = {
        type: r[0],
        size: r[1],
        code: r[2],
        stock: r[3],
        oldPrice: r[4],
        salePrice: r[5]
      };
      break;
    }
  }

  if (!item || foundRow === -1) {
    return { price: config.salePriceVN || config.salePrice || "459999", stockLeft: "Không theo dõi" };
  }

  const price = item.salePrice || item.oldPrice || config.salePriceVN || "459999";
  const currentStock = Number(String(item.stock || "").replace(/\D/g, ""));

  if (!Number.isFinite(currentStock) || item.stock === "") {
    return { price, stockLeft: "Không theo dõi" };
  }

  if (currentStock < quantity) {
    throw new Error("Sản phẩm " + variant + " - " + size + " chỉ còn " + currentStock + ", không đủ số lượng đặt");
  }

  const newStock = Math.max(0, currentStock - quantity);
  sheet.getRange(foundRow, 4).setValue(newStock); // Cập nhật trực tiếp cột Tồn kho trong Sheet BangGia_VN

  return { price, stockLeft: String(newStock) };
}

function updateTaiwanPriceTableStock_(data, config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreatePriceSheet_(ss, SHEET_PRICES_TW, defaultPriceTableTW_());
  const values = sheet.getDataRange().getValues();
  const variant = String(data.variant || "").trim();
  const size = String(data.size || "").trim();
  const quantity = Math.max(1, Number(data.quantity || 1));

  let foundRow = -1;
  let item = null;

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[0] || "").trim() === variant && String(r[1] || "").trim() === size) {
      foundRow = i + 1;
      item = {
        type: r[0],
        size: r[1],
        code: r[2],
        stock: r[3],
        oldPrice: r[4],
        salePrice: r[5]
      };
      break;
    }
  }

  if (!item || foundRow === -1) {
    return { price: config.salePriceTW || "599", stockLeft: "Không theo dõi" };
  }

  const price = item.salePrice || item.oldPrice || config.salePriceTW || "599";
  const currentStock = Number(String(item.stock || "").replace(/\D/g, ""));

  if (!Number.isFinite(currentStock) || item.stock === "") {
    return { price, stockLeft: "Không theo dõi" };
  }

  if (currentStock < quantity) {
    throw new Error("Sản phẩm " + variant + " - " + size + " tại Đài Loan chỉ còn " + currentStock + ", không đủ số lượng đặt");
  }

  const newStock = Math.max(0, currentStock - quantity);
  sheet.getRange(foundRow, 4).setValue(newStock); // Cập nhật trực tiếp cột Tồn kho trong Sheet BangGia_TW

  return { price, stockLeft: String(newStock) };
}

function savePrivateProps_(config) {
  const props = PropertiesService.getScriptProperties();

  if (config.telegramBotToken) props.setProperty("TELEGRAM_BOT_TOKEN", config.telegramBotToken.trim());
  if (config.telegramChatId) props.setProperty("TELEGRAM_CHAT_ID", config.telegramChatId.trim());
  if (config.adminEmail) props.setProperty("ADMIN_EMAIL", config.adminEmail.trim());
  if (config.newAdminUsername && config.newAdminUsername.trim()) {
    props.setProperty("ADMIN_USERNAME", config.newAdminUsername.trim());
  }
  if (config.newAdminKey && config.newAdminKey.trim()) {
    props.setProperty("ADMIN_KEY", config.newAdminKey.trim());
  }
}

// BẢO VỆ CHỐNG BRUTE-FORCE TÀI KHOẢN & MẬT KHẨU ADMIN
function checkAdminWithBruteForceGuard_(username, password) {
  const cache = CacheService.getScriptCache();
  const failCountKey = "admin_fail_attempts";
  const lockKey = "admin_lockout_active";

  if (cache.get(lockKey)) {
    throw new Error("Hệ thống đang bị tạm khóa 10 phút do nhập sai thông tin quản trị quá 5 lần.");
  }

  const props = PropertiesService.getScriptProperties();
  let adminUser = props.getProperty("ADMIN_USERNAME");
  let adminKey = props.getProperty("ADMIN_KEY");

  if (!adminUser) {
    adminUser = "admin";
    props.setProperty("ADMIN_USERNAME", adminUser);
  }
  if (!adminKey) {
    adminKey = "123456";
    props.setProperty("ADMIN_KEY", adminKey);
  }

  const inputUser = String(username || "").trim();
  const inputPass = String(password || "").trim();

  // Kiểm tra tài khoản & mật khẩu (hỗ trợ cả trường hợp tương thích)
  const isUserValid = !username || inputUser.toLowerCase() === String(adminUser).trim().toLowerCase();
  const isPassValid = inputPass === String(adminKey).trim();

  if (!isUserValid || !isPassValid) {
    let fails = Number(cache.get(failCountKey) || 0) + 1;
    if (fails >= 5) {
      cache.put(lockKey, "locked", 600); // Khóa 10 phút (600s)
      cache.remove(failCountKey);
      throw new Error("Sai thông tin đăng nhập quá 5 lần. Hệ thống đã khóa truy cập Admin trong 10 phút.");
    } else {
      cache.put(failCountKey, String(fails), 300); // Lưu đếm trong 5 phút
      throw new Error("Tài khoản hoặc mật khẩu không chính xác (Sai " + fails + "/5 lần).");
    }
  }

  // Nếu nhập đúng -> Reset bộ đếm lỗi
  cache.remove(failCountKey);
}

function getOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateOrdersSheet_(ss);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(h => String(h || "").trim().toLowerCase());
  
  // Tự động tìm vị trí cột chính xác
  const getCol = (exactList) => {
    // 1. Tìm khớp chính xác trước
    let idx = headers.findIndex(h => exactList.some(e => h === e));
    if (idx !== -1) return idx;
    // 2. Tìm chứa chuỗi
    return headers.findIndex(h => exactList.some(e => h.includes(e)));
  };

  const cTime = getCol(["thời gian", "timestamp", "date", "createdat"]);
  const cOrderId = getCol(["mã đơn", "orderid", "order_id", "mã"]);
  const cMarket = getCol(["thị trường", "market", "quốc gia"]);
  const cProduct = getCol(["tên sản phẩm", "sản phẩm", "product"]);
  const cName = getCol(["họ tên", "họ và tên", "khách hàng", "người nhận", "tên khách", "customer"]);
  const cPhone = getCol(["số điện thoại", "sđt", "phone", "điện thoại", "tel"]);
  const cAddress = getCol(["địa chỉ", "địa chỉ chi tiết", "địa chỉ giao", "address"]);
  const cProvince = getCol(["tỉnh/thành phố", "tỉnh/tp", "tỉnh", "thành phố", "province"]);
  const cDistrict = getCol(["quận/huyện", "quận", "huyện", "district"]);
  const cWard = getCol(["phường/xã", "phường", "xã", "ward"]);
  const cVariant = getCol(["phân loại", "loại", "variant", "type"]);
  const cSize = getCol(["kích cỡ", "size đá", "size", "cỡ"]);
  const cQuantity = getCol(["số lượng", "quantity", "qty", "sl"]);
  const cCombo = getCol(["gói combo", "combo"]);
  const cPayment = getCol(["hình thức thanh toán", "thanh toán", "payment"]);
  const cPrice = getCol(["tổng thanh toán", "tổng tiền", "giá", "price"]);
  const cNote = getCol(["ghi chú", "note"]);
  const cMap = getCol(["google maps", "maps", "bản đồ"]);
  const cStatus = getCol(["trạng thái", "status"]);

  const rows = [];

  for (let i = Math.max(1, values.length - 100); i < values.length; i++) {
    const r = values[i];
    
    // Nếu dòng trống hoàn toàn thì bỏ qua
    if (!r || r.every(cell => cell === "" || cell === null || cell === undefined)) continue;

    const val = (idx) => (idx !== -1 && r[idx] !== undefined && r[idx] !== null) ? String(r[idx]).trim() : "";

    // Xử lý Ngày giờ
    let createdAt = r[cTime !== -1 ? cTime : 0];
    if (createdAt instanceof Date) {
      createdAt = Utilities.formatDate(createdAt, "GMT+7", "dd/MM/yyyy HH:mm");
    } else {
      createdAt = String(createdAt || "");
      if (createdAt.includes("T") && createdAt.includes("Z")) {
        try {
          const d = new Date(createdAt);
          createdAt = Utilities.formatDate(d, "GMT+7", "dd/MM/yyyy HH:mm");
        } catch(e) {}
      }
    }

    const orderId = val(cOrderId !== -1 ? cOrderId : 1);
    
    // Xử lý Khách hàng & SĐT
    let name = val(cName);
    let phone = val(cPhone);

    // Tự động hoán đổi nếu dòng cũ bị đảo ngược giữa Tên và SĐT
    if (/^\d{7,12}$/.test(name) && !/^\d{7,12}$/.test(phone)) {
      const temp = name;
      name = phone;
      phone = temp;
    }

    // Tự động khôi phục số 0 đầu nếu bị mất
    if (phone && /^\d{9}$/.test(phone)) {
      phone = "0" + phone;
    }

    // Xử lý Địa chỉ
    const addr = val(cAddress);
    const ward = val(cWard);
    const district = val(cDistrict);
    const province = val(cProvince);
    const fullAddress = [addr, ward, district, province]
      .filter(Boolean)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .join(", ");

    // Xử lý Thị trường
    let market = val(cMarket);
    const priceStr = val(cPrice);
    const isTW = market.includes("Đài Loan") || market.includes("TW") || priceStr.includes("NT$") || (phone.startsWith("09") && phone.length === 10 && val(cPayment).includes("Đài Loan"));
    if (!market || market.includes("Bông nụ") || market.length > 25) {
      market = isTW ? "Đài Loan (NT$)" : "Việt Nam (VNĐ)";
    }

    rows.unshift({
      createdAt: createdAt,
      orderId: orderId || ("PGD-" + i),
      market: market,
      product: val(cProduct) || "Bông nụ bạc S925 Moissanite",
      name: name,
      phone: phone,
      address: fullAddress || addr,
      variant: val(cVariant) || "1 Đôi",
      size: val(cSize) || "5mm",
      quantity: val(cQuantity) || "1",
      combo: val(cCombo),
      payment: val(cPayment) || (isTW ? "COD Đài Loan" : "COD"),
      price: priceStr,
      note: val(cNote),
      status: val(cStatus) || "Mới"
    });
  }

  return rows;
}

// Bọc an toàn Telegram để không làm đứt đoạn luồng ghi đơn
function safeSendTelegram_(text) {
  try {
    const props = PropertiesService.getScriptProperties();
    let token = props.getProperty("TELEGRAM_BOT_TOKEN");
    let chatId = props.getProperty("TELEGRAM_CHAT_ID");

    // Fallback: Nếu ScriptProperties chưa có, kiểm tra sheet Config
    if (!token || !chatId) {
      const cfg = getConfig_();
      token = token || cfg.telegramBotToken;
      chatId = chatId || cfg.telegramChatId;
    }

    if (!token || !chatId) {
      console.log("Chưa cấu hình Telegram Bot Token hoặc Chat ID.");
      return;
    }

    UrlFetchApp.fetch(`https://api.telegram.org/bot${String(token).trim()}/sendMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: String(chatId).trim(), text }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.log("Cảnh báo Telegram: " + e.toString());
  }
}

// Bọc an toàn Gmail để không làm đứt đoạn luồng ghi đơn khi hết Quota
function safeSendGmail_(orderId, text) {
  try {
    const props = PropertiesService.getScriptProperties();
    let email = props.getProperty("ADMIN_EMAIL");

    // Fallback: Nếu ScriptProperties chưa có, kiểm tra sheet Config
    if (!email) {
      const cfg = getConfig_();
      email = email || cfg.adminEmail;
    }

    if (!email) {
      console.log("Chưa cấu hình Email nhận đơn.");
      return;
    }

    GmailApp.sendEmail(String(email).trim(), "Đơn hàng mới " + orderId + " - Phú Gia Diamond", text);
  } catch (e) {
    console.log("Cảnh báo Gmail (có thể do hết quota ngày): " + e.toString());
  }
}

function formatMoney_(value) {
  const n = Number(String(value || 0).replace(/\D/g, ""));
  return n.toLocaleString("vi-VN");
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

// ================= BẮT LEAD RƠI RỚT (ABANDONED RECOVERY) =================
function getOrCreateAbandonedSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_ABANDONED);
  const headers = [
    "Thời gian", "Thị trường", "Số điện thoại", "Họ tên", "Sản phẩm", "Phân loại", "Size đá",
    "Địa chỉ tạm", "Tỉnh/TP", "Trạng thái", "Nguồn / Link"
  ];
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ABANDONED);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#fff3cd");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function handleAbandonedLead_(data) {
  const m = String(data.market || "").toUpperCase();
  const isTaiwan = m.includes("TW") || m.includes("TAIWAN") || data.currency === "TWD" || String(data.payment || "").includes("Đài Loan") || String(data.source || "").toLowerCase().includes("taiwan");
  const rawPhone = String(data.phone || "").replace(/[\s\-\.]/g, "");
  
  const vnPhoneRegex = /^(0[3|5|7|8|9]|84[3|5|7|8|9])[0-9]{8}$/;
  const twPhoneRegex = /^(09[0-9]{8}|(\+?8869)[0-9]{8})$/;

  if (isTaiwan ? !twPhoneRegex.test(rawPhone) : !vnPhoneRegex.test(rawPhone)) {
    return json_({ ok: false, error: "Số điện thoại không hợp lệ." });
  }

  // Chống spam lead trong vòng 5 phút cùng 1 SĐT
  const cache = CacheService.getScriptCache();
  const cacheKey = "abandoned_lead_" + rawPhone;
  if (cache.get(cacheKey)) {
    return json_({ ok: true, message: "Lead đã được ghi nhận trước đó." });
  }
  cache.put(cacheKey, "recorded", 300);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateAbandonedSheet_(ss);
    const createdAt = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
    const marketLabel = isTaiwan ? "Đài Loan (NT$)" : "Việt Nam (VNĐ)";

    // Kiểm tra xem SĐT này đã có trong sheet Khach_Roi_Rat chưa
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    let phoneRowIndex = -1;

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][2]).replace(/\D/g, "") === rawPhone.replace(/\D/g, "")) {
        phoneRowIndex = i + 1; // 1-based index
        break;
      }
    }

    const rowData = [
      createdAt,
      marketLabel,
      cleanText_(rawPhone),
      cleanText_(data.name || "Chưa nhập tên"),
      cleanText_(data.product || "Bông tai Moissanite"),
      cleanText_(data.variant || ""),
      cleanText_(data.size || ""),
      cleanText_(data.address || ""),
      cleanText_(data.province || ""),
      "⏳ Chưa hoàn tất (Đang nhập dở)",
      cleanText_(data.source || "")
    ];

    if (phoneRowIndex > 0) {
      // Cập nhật dòng cũ nếu chưa chốt đơn
      const currentStatus = String(values[phoneRowIndex - 1][9] || "");
      if (!currentStatus.includes("Đã chốt")) {
        sheet.getRange(phoneRowIndex, 1, 1, rowData.length).setValues([rowData]);
      }
    } else {
      sheet.appendRow(rowData);
    }

    return json_({ ok: true, message: "Đã lưu thông tin khách rơi rớt thành công." });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function updateAbandonedLeadStatus_(phone, orderId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_ABANDONED);
    if (!sheet) return;

    const values = sheet.getDataRange().getValues();
    const cleanP = String(phone || "").replace(/\D/g, "");
    if (!cleanP) return;

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][2]).replace(/\D/g, "") === cleanP) {
        sheet.getRange(i + 1, 10).setValue("✅ Đã chốt đơn (" + orderId + ")");
      }
    }
  } catch(e) {
    // Không làm gián đoạn luồng đặt hàng
  }
}

