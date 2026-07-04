// ===== تهيئة Supabase =====
const SUPABASE_URL = 'https://bxnyzrsokorvaaswjraw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_d4MCzBoNyNGIX19why_0tQ_lgcTNEFo';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== إعدادات المتجر =====
const STORE_NAME = '📘 متجر القرطاسية المركزي';
const STORE_PHONE = '📞 0770 123 4567';

let cart = [];
let currentTenantId = null;
let currentUserRole = null;
let online = navigator.onLine;

// ===== دوال مساعدة للرسائل =====
function showLoginMessage(msg, isError = false) {
  const el = document.getElementById('loginMessage');
  el.textContent = msg;
  el.style.color = isError ? '#dc2626' : '#16a34a';
}
function showProductMessage(msg, isError = false) {
  const el = document.getElementById('productMsg');
  el.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success');
  el.textContent = msg;
}
function showPosMessage(msg, isError = false) {
  const el = document.getElementById('posMsg');
  el.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success');
  el.textContent = msg;
}
function updateConnectionStatus() {
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;
  online = navigator.onLine;
  if (online) {
    statusEl.innerHTML = '<i class="fas fa-wifi" style="color:#10b981;"></i> متصل';
    statusEl.style.color = '#10b981';
  } else {
    statusEl.innerHTML = '<i class="fas fa-wifi-slash" style="color:#ef4444;"></i> غير متصل (يعمل محلياً)';
    statusEl.style.color = '#ef4444';
  }
}

// ===== تهيئة IndexedDB (Dexie) =====
const db = new Dexie('SchoolPOSDB');
db.version(1).stores({
  products: 'id, barcode, tenant_id, is_synced',
  invoices: 'id, tenant_id, is_synced, created_at',
  invoice_items: 'id, invoice_id, product_id'
});

// ===== التحقق من الاتصال والمزامنة =====
window.addEventListener('online', function() {
  online = true;
  updateConnectionStatus();
  setTimeout(() => {
    syncPendingInvoices();
    syncPendingProducts();
  }, 3000);
});
window.addEventListener('offline', function() {
  online = false;
  updateConnectionStatus();
});

setInterval(() => {
  const wasOnline = online;
  online = navigator.onLine;
  if (wasOnline !== online) {
    updateConnectionStatus();
    if (online) {
      setTimeout(() => {
        syncPendingInvoices();
        syncPendingProducts();
      }, 3000);
    }
  }
}, 10000);

// ===== دوال المزامنة =====
async function syncPendingInvoices() {
  if (!online) return;
  try {
    const pendingInvoices = await db.invoices.where('is_synced').equals(0).toArray();
    if (pendingInvoices.length === 0) return;
    console.log(`🔄 مزامنة ${pendingInvoices.length} فاتورة...`);
    for (const localInv of pendingInvoices) {
      const items = await db.invoice_items.where('invoice_id').equals(localInv.id).toArray();
      const { data: supInv, error: invErr } = await supabaseClient
        .from('invoices')
        .insert({
          tenant_id: localInv.tenant_id,
          cashier_id: localInv.cashier_id,
          invoice_number: localInv.invoice_number,
          total_before_discount: localInv.total_before_discount,
          discount_value: localInv.discount_value || 0,
          final_total: localInv.final_total,
          status: 'completed',
          is_synced: true
        })
        .select()
        .single();
      if (invErr) throw invErr;
      for (const item of items) {
        await supabaseClient.from('invoice_items').insert({
          invoice_id: supInv.id,
          product_id: item.product_id,
          unit_type: 'piece',
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price
        });
      }
      for (const item of items) {
        const { data: prod } = await supabaseClient
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .single();
        if (prod) {
          await supabaseClient
            .from('products')
            .update({ stock_quantity: prod.stock_quantity - item.quantity })
            .eq('id', item.product_id);
        }
      }
      await db.invoices.update(localInv.id, { is_synced: 1 });
      console.log(`✅ تمت مزامنة الفاتورة ${localInv.invoice_number}`);
    }
    await loadProducts();
    await loadDashboardStats();
  } catch (error) {
    console.error('❌ فشل المزامنة:', error);
  }
}

async function syncPendingProducts() {
  if (!online) return;
  try {
    const pendingProds = await db.products.where('is_synced').equals(0).toArray();
    if (pendingProds.length === 0) return;
    for (const p of pendingProds) {
      const { error } = await supabaseClient.from('products').insert({
        name_ar: p.name_ar,
        barcode: p.barcode,
        purchase_price: p.purchase_price || 0,
        unit_piece_price: p.unit_piece_price,
        stock_quantity: p.stock_quantity,
        tenant_id: p.tenant_id
      });
      if (!error) {
        await db.products.update(p.id, { is_synced: 1 });
        console.log(`✅ تمت مزامنة المنتج ${p.name_ar}`);
      }
    }
    await loadProducts();
  } catch (error) {
    console.error('❌ فشل مزامنة المنتجات:', error);
  }
}

// ===== تسجيل الدخول =====
async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (!email || !password) { showLoginMessage('⚠️ الرجاء ملء جميع الحقول', true); return; }
  showLoginMessage('⏳ جاري الدخول...');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { showLoginMessage('❌ ' + error.message, true); }
  else {
    showLoginMessage('✅ تم الدخول بنجاح!');
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    await loadUserProfile();
    await loadDashboardStats();
    await loadProducts();
    goHome();
    updateConnectionStatus();
    if (online) {
      setTimeout(() => {
        syncPendingInvoices();
        syncPendingProducts();
      }, 3000);
    }
  }
}

async function loadUserProfile() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  let profile = null;
  if (online) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', user.id)
      .single();
    if (!error && data) profile = data;
  }
  if (!profile) {
    const localProfile = await db.profiles?.get(user.id);
    if (localProfile) profile = localProfile;
  }
  if (profile) {
    currentUserRole = profile.role;
    currentTenantId = profile.tenant_id;
    console.log('✅ دور المستخدم:', currentUserRole, ' | Tenant:', currentTenantId);
  } else {
    console.error('❌ لم يتم العثور على الملف الشخصي');
  }
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  cart = [];
  currentUserRole = null;
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
}

// ===== التنقل =====
function navigateTo(sectionId) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('section-' + sectionId);
  if (target) target.classList.add('active');
  const titles = { dashboard: 'لوحة التحكم', inventory: 'إدارة المخزون', pos: 'نقطة البيع', reports: 'التقارير' };
  document.getElementById('pageTitle').textContent = titles[sectionId] || 'القسم';
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('pageContainer').style.display = 'block';
}

function goHome() {
  document.getElementById('pageContainer').style.display = 'none';
  document.getElementById('mainMenu').style.display = 'flex';
  const dashboardCard = document.querySelector('.menu-card[data-section="dashboard"]');
  const inventoryCard = document.querySelector('.menu-card[data-section="inventory"]');
  const posCard = document.querySelector('.menu-card[data-section="pos"]');
  const reportsCard = document.querySelector('.menu-card[data-section="reports"]');
  
  if (currentUserRole === 'cashier') {
    if (dashboardCard) dashboardCard.style.display = 'none';
    if (inventoryCard) inventoryCard.style.display = 'none';
    if (posCard) posCard.style.display = 'block';
    if (reportsCard) reportsCard.style.display = 'none';
    document.querySelector('.menu-container h2').textContent = '🧾 نظام البيع (الكاشير)';
    document.querySelector('.menu-container p').textContent = 'اضغط على بطاقة البيع لبدء إضافة الفواتير';
  } else {
    if (dashboardCard) dashboardCard.style.display = 'block';
    if (inventoryCard) inventoryCard.style.display = 'block';
    if (posCard) posCard.style.display = 'block';
    if (reportsCard) reportsCard.style.display = 'block';
    document.querySelector('.menu-container h2').textContent = '🏪 لوحة التحكم الرئيسية';
    document.querySelector('.menu-container p').textContent = 'اختر القسم الذي تريد العمل عليه';
  }
}

// ===== جلب المنتجات =====
async function loadProducts() {
  let products = [];
  online = navigator.onLine;
  if (online) {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .eq('tenant_id', currentTenantId)
      .order('created_at', { ascending: false });
    if (!error && data) {
      products = data;
      await db.products.bulkPut(data.map(p => ({ ...p, is_synced: 1 })));
    } else {
      products = await db.products.where('tenant_id').equals(currentTenantId).toArray();
    }
  } else {
    products = await db.products.where('tenant_id').equals(currentTenantId).toArray();
  }
  
  const tbody = document.getElementById('productTableBody');
  if (!products || products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">لا توجد منتجات بعد</td></tr>';
    return;
  }
  tbody.innerHTML = products.map((p, i) => `
    <tr>
      <td>${i+1}</td>
      <td><span class="badge">${p.name_ar}</span></td>
      <td>${p.barcode || '-'}</td>
      <td>${parseFloat(p.purchase_price || 0).toFixed(2)} د.ع</td>
      <td>${parseFloat(p.unit_piece_price).toFixed(2)} د.ع</td>
      <td>${p.stock_quantity}</td>
      <td style="text-align:center; display:flex; gap:5px; justify-content:center;">
        <button class="edit-btn" data-id="${p.id}" style="background:#f59e0b; color:white; border:none; padding:5px 12px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600;">
          <i class="fas fa-edit"></i> تعديل
        </button>
        <button class="delete-btn" data-id="${p.id}" data-name="${p.name_ar}" style="background:#ef4444; color:white; border:none; padding:5px 12px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600;">
          <i class="fas fa-trash"></i> حذف
        </button>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', function() { openEditModal(this.dataset.id); });
  });
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', function() { deleteProduct(this.dataset.id, this.dataset.name); });
  });
}

// ===== إضافة منتج =====
async function addProduct() {
  if (currentUserRole !== 'owner') { showProductMessage('⛔ غير مصرح لك بإضافة منتجات', true); return; }
  if (!currentTenantId) { showProductMessage('⚠️ لم يتم ربط حسابك بمتجر.', true); return; }
  const name = document.getElementById('pName').value.trim();
  const barcode = document.getElementById('pBarcode').value.trim();
  const purchasePrice = parseFloat(document.getElementById('pPurchasePrice').value) || 0;
  const price = parseFloat(document.getElementById('pPrice').value) || 0;
  const stock = parseInt(document.getElementById('pStock').value) || 0;
  if (!name) { showProductMessage('⚠️ أدخل اسم المنتج', true); return; }
  
  online = navigator.onLine;
  
  const productData = {
    name_ar: name,
    barcode: barcode || null,
    purchase_price: purchasePrice,
    unit_piece_price: price,
    stock_quantity: stock,
    tenant_id: currentTenantId
  };
  
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const localProduct = { id, ...productData, is_synced: online ? 1 : 0 };
  
  await db.products.add(localProduct);
  
  if (online) {
    const { data, error } = await supabaseClient.from('products').insert(productData).select();
    if (!error && data && data.length > 0) {
      await db.products.update(id, { 
        is_synced: 1,
        id: data[0].id 
      });
      showProductMessage('✅ تم إضافة المنتج بنجاح!', false);
    } else {
      showProductMessage('⚠️ تم الحفظ محلياً، سيتم المزامنة تلقائياً.', false);
    }
  } else {
    showProductMessage('✅ تم إضافة المنتج محلياً! سيتزامن عند عودة النت.', false);
  }
  
  await loadProducts();
  await loadDashboardStats();
  
  document.getElementById('pName').value = '';
  document.getElementById('pBarcode').value = '';
  document.getElementById('pPurchasePrice').value = '';
  document.getElementById('pPrice').value = '';
  document.getElementById('pStock').value = '';
}

// ===== إحصاءات لوحة التحكم =====
async function loadDashboardStats() {
  online = navigator.onLine;
  let products = [];
  
  if (online) {
    const { count, error } = await supabaseClient
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', currentTenantId);
    if (!error) document.getElementById('totalProducts').textContent = count || 0;
    else {
      products = await db.products.where('tenant_id').equals(currentTenantId).toArray();
      document.getElementById('totalProducts').textContent = products.length;
    }
  } else {
    products = await db.products.where('tenant_id').equals(currentTenantId).toArray();
    document.getElementById('totalProducts').textContent = products.length;
  }

  // مبيعات اليوم
  const today = new Date().toISOString().split('T')[0];
  let totalSales = 0;
  if (online) {
    const { data: salesData, error: salesError } = await supabaseClient
      .from('invoices')
      .select('final_total')
      .eq('tenant_id', currentTenantId)
      .gte('created_at', today)
      .lt('created_at', today + 'T23:59:59');
    if (!salesError && salesData) {
      totalSales = salesData.reduce((sum, inv) => sum + inv.final_total, 0);
    }
  } else {
    const localInvoices = await db.invoices
      .where('tenant_id')
      .equals(currentTenantId)
      .and(inv => inv.created_at && inv.created_at.startsWith(today))
      .toArray();
    totalSales = localInvoices.reduce((sum, inv) => sum + inv.final_total, 0);
  }
  document.getElementById('todaySales').textContent = totalSales.toFixed(2);

  // المنتجات المنخفضة المخزون
  let lowStock = [];
  if (online) {
    const { data, error } = await supabaseClient
      .from('products')
      .select('name_ar, stock_quantity')
      .eq('tenant_id', currentTenantId)
      .lte('stock_quantity', 5)
      .order('stock_quantity', { ascending: true })
      .limit(10);
    if (!error && data) lowStock = data;
    else {
      lowStock = await db.products
        .where('tenant_id')
        .equals(currentTenantId)
        .and(p => p.stock_quantity <= 5)
        .toArray();
    }
  } else {
    lowStock = await db.products
      .where('tenant_id')
      .equals(currentTenantId)
      .and(p => p.stock_quantity <= 5)
      .toArray();
  }
  const list = document.getElementById('lowStockList');
  document.getElementById('lowStockCount').textContent = lowStock.length;
  if (lowStock.length === 0) {
    list.innerHTML = '<p style="color:#94a3b8; text-align:center;">جميع المنتجات متوفرة</p>';
  } else {
    list.innerHTML = lowStock.map(item => `
      <div class="insight-item">
        <span>${item.name_ar}</span>
        <span class="value badge badge-danger">${item.stock_quantity} قطعة</span>
      </div>
    `).join('');
  }

  // ===== أكثر المنتجات مبيعاً =====
  const topList = document.getElementById('topProductsList');
  try {
    let invoiceItems = [];
    if (online) {
      const { data, error } = await supabaseClient
        .from('invoice_items')
        .select(`
          product_id,
          quantity,
          products ( name_ar )
        `)
        .eq('products.tenant_id', currentTenantId);
      if (!error && data) invoiceItems = data;
      else {
        invoiceItems = await db.invoice_items.toArray();
        for (const item of invoiceItems) {
          const prod = await db.products.get(item.product_id);
          if (prod) item.products = { name_ar: prod.name_ar };
        }
      }
    } else {
      invoiceItems = await db.invoice_items.toArray();
      for (const item of invoiceItems) {
        const prod = await db.products.get(item.product_id);
        if (prod) item.products = { name_ar: prod.name_ar };
      }
    }
    const productMap = {};
    invoiceItems.forEach(item => {
      const productId = item.product_id;
      const productName = item.products?.name_ar || 'منتج محذوف';
      if (!productMap[productId]) {
        productMap[productId] = { name: productName, quantity: 0 };
      }
      productMap[productId].quantity += item.quantity;
    });
    const sorted = Object.values(productMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
    if (sorted.length === 0) {
      topList.innerHTML = '<p style="color:#94a3b8; text-align:center;">لا توجد مبيعات بعد</p>';
    } else {
      topList.innerHTML = sorted.map((item, idx) => `
        <div class="insight-item">
          <span><span class="rank">${idx + 1}</span> ${item.name}</span>
          <span class="value">${item.quantity}</span>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('❌ خطأ في جلب أكثر المنتجات مبيعاً:', error);
    topList.innerHTML = '<p style="color:#dc2626; text-align:center;">حدث خطأ في تحميل البيانات</p>';
  }

  // ===== حساب صافي الربح الشهري =====
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    let invoices = [];
    if (online) {
      const { data, error } = await supabaseClient
        .from('invoices')
        .select(`
          id,
          created_at,
          invoice_items (
            product_id,
            quantity,
            unit_price,
            products ( purchase_price )
          )
        `)
        .eq('tenant_id', currentTenantId)
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth);
      if (!error && data) invoices = data;
      else {
        invoices = await db.invoices
          .where('tenant_id')
          .equals(currentTenantId)
          .and(inv => inv.created_at >= startOfMonth && inv.created_at <= endOfMonth)
          .toArray();
        for (const inv of invoices) {
          inv.invoice_items = await db.invoice_items.where('invoice_id').equals(inv.id).toArray();
          for (const item of inv.invoice_items) {
            const prod = await db.products.get(item.product_id);
            if (prod) item.products = { purchase_price: prod.purchase_price || 0 };
          }
        }
      }
    } else {
      invoices = await db.invoices
        .where('tenant_id')
        .equals(currentTenantId)
        .and(inv => inv.created_at >= startOfMonth && inv.created_at <= endOfMonth)
        .toArray();
      for (const inv of invoices) {
        inv.invoice_items = await db.invoice_items.where('invoice_id').equals(inv.id).toArray();
        for (const item of inv.invoice_items) {
          const prod = await db.products.get(item.product_id);
          if (prod) item.products = { purchase_price: prod.purchase_price || 0 };
        }
      }
    }

    let totalProfit = 0;
    invoices.forEach(inv => {
      inv.invoice_items.forEach(item => {
        const purchasePrice = item.products?.purchase_price || 0;
        totalProfit += (item.unit_price - purchasePrice) * item.quantity;
      });
    });

    document.getElementById('monthlyProfit').textContent = totalProfit.toFixed(2);
  } catch (error) {
    console.error('❌ خطأ في حساب الربح الشهري:', error);
    document.getElementById('monthlyProfit').textContent = '0.00';
  }
}

// ===== دوال البيع =====
async function addToInvoice() {
  const barcode = document.getElementById('barcodeScanner').value.trim();
  const nameSearch = document.getElementById('productNameSearch').value.trim();
  let product = null;

  if (barcode) {
    product = await db.products.where('barcode').equals(barcode).first();
  }
  if (!product && nameSearch) {
    product = await db.products.where('name_ar').startsWithIgnoreCase(nameSearch).first();
  }

  if (!product) { showPosMessage('❌ المنتج غير موجود', true); return; }
  
  // التحقق من المخزون
  if (product.stock_quantity < 1) {
    showPosMessage(`⚠️ المنتج "${product.name_ar}" غير متوفر في المخزون!`, true);
    return;
  }

  // التحقق من الكمية في السلة
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    if (existing.quantity >= product.stock_quantity) {
      showPosMessage(`⚠️ الكمية المطلوبة (${existing.quantity + 1}) تتجاوز المخزون المتوفر (${product.stock_quantity})`, true);
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }

  // تحذير المخزون المنخفض
  if (product.stock_quantity <= 5) {
    const msgDiv = document.getElementById('posMsg');
    msgDiv.className = 'msg-box msg-warning';
    msgDiv.textContent = `⚠️ تنبيه: مخزون "${product.name_ar}" منخفض (${product.stock_quantity} قطع متبقية فقط!)`;
  }

  renderCart();
  document.getElementById('barcodeScanner').value = '';
  document.getElementById('productNameSearch').value = '';
  document.getElementById('barcodeScanner').focus();

  const msgDiv = document.getElementById('posMsg');
  if (!msgDiv.classList.contains('msg-warning')) {
    showPosMessage(`✅ تم إضافة ${product.name_ar}`, false);
  }
}

function renderCart() {
  const container = document.getElementById('cartItems');
  if (cart.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;">الفاتورة فارغة</p>';
    updateCartTotal();
    return;
  }
  container.innerHTML = cart.map(item => {
    const totalPrice = (item.unit_piece_price * item.quantity).toFixed(2);
    return `
      <div class="cart-item" data-id="${item.id}">
        <div style="display:flex; align-items:center; gap:10px; flex:1; flex-wrap:wrap;">
          <span class="badge">${item.name_ar}</span>
          <div style="display:flex; align-items:center; gap:5px;">
            <button class="qty-btn" data-id="${item.id}" data-action="decrease" style="background:#e2e8f0; border:none; width:28px; height:28px; border-radius:8px; font-weight:bold; cursor:pointer; transition:0.2s;">−</button>
            <span style="font-weight:700; min-width:25px; text-align:center;">${item.quantity}</span>
            <button class="qty-btn" data-id="${item.id}" data-action="increase" style="background:#e2e8f0; border:none; width:28px; height:28px; border-radius:8px; font-weight:bold; cursor:pointer; transition:0.2s;">+</button>
          </div>
        </div>
        <span>${totalPrice} د.ع</span>
      </div>
    `;
  }).join('');
  updateCartTotal();
}

function updateCartTotal() {
  const total = cart.reduce((sum, i) => sum + (i.unit_piece_price * i.quantity), 0);
  document.getElementById('cartTotal').textContent = total.toFixed(2);
}

function increaseQuantity(productId) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  if (item.quantity >= item.stock_quantity) {
    showPosMessage('⚠️ لا يوجد مخزون كافي', true);
    return;
  }
  item.quantity += 1;
  renderCart();
}

function decreaseQuantity(productId) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  if (item.quantity > 1) {
    item.quantity -= 1;
  } else {
    cart = cart.filter(i => i.id !== productId);
  }
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
  showPosMessage('🔄 تم تفريغ الفاتورة', false);
}

// ===== دالة الطباعة المتقدمة =====
function printInvoice(invoiceNumber, items, total) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  let itemsHtml = '';
  items.forEach((item, index) => {
    const itemTotal = (item.unit_piece_price * item.quantity).toFixed(2);
    itemsHtml += `
      <tr>
        <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:center; font-size:12px;">${index + 1}</td>
        <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; font-size:12px;">${item.name_ar}</td>
        <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:center; font-size:12px;">${item.quantity}</td>
        <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:center; font-size:12px;">${item.unit_piece_price.toFixed(2)}</td>
        <td style="padding:4px 3px; border-bottom:1px solid #e2e8f0; text-align:left; font-size:12px;">${itemTotal} د.ع</td>
      </tr>
    `;
  });

  const autoPrint = document.getElementById('autoPrintCheckbox')?.checked || false;

  const printContent = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>فاتورة البيع</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Courier New', 'Tajawal', monospace;
          background: #fff;
          margin: 0;
          padding: 8px;
          width: 80mm;
          margin: auto;
        }
        .invoice-box {
          max-width: 100%;
          padding: 5px;
          border: none;
        }
        .header {
          text-align: center;
          border-bottom: 2px dashed #000;
          padding-bottom: 8px;
          margin-bottom: 10px;
        }
        .header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: 1px;
        }
        .header .sub {
          font-size: 12px;
          color: #333;
          margin: 3px 0;
        }
        .header .invoice-num {
          font-size: 14px;
          font-weight: 700;
          margin-top: 4px;
          background: #f1f5f9;
          padding: 2px 8px;
          border-radius: 4px;
          display: inline-block;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 8px 0;
          font-size: 12px;
        }
        th {
          background: #f1f5f9;
          padding: 6px 4px;
          text-align: center;
          font-weight: 700;
          font-size: 12px;
          border-bottom: 2px solid #000;
        }
        td {
          padding: 4px 3px;
          text-align: center;
          border-bottom: 1px dashed #e2e8f0;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          font-size: 18px;
          font-weight: 800;
          padding-top: 12px;
          margin-top: 10px;
          border-top: 3px double #000;
        }
        .footer {
          text-align: center;
          font-size: 12px;
          margin-top: 15px;
          border-top: 1px dashed #000;
          padding-top: 10px;
          color: #333;
        }
        .footer .phone {
          font-weight: 700;
          margin-top: 4px;
        }
        .no-print {
          text-align: center;
          margin-top: 15px;
        }
        .no-print button {
          padding: 10px 30px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: 0.2s;
          font-family: 'Tajawal', sans-serif;
        }
        .btn-print {
          background: #4f46e5;
          color: white;
          margin-left: 8px;
        }
        .btn-print:hover { background: #4338ca; transform: scale(1.02); }
        .btn-close {
          background: #ef4444;
          color: white;
        }
        .btn-close:hover { background: #dc2626; }
        @media print {
          body { margin: 0; padding: 5px; width: 100%; }
          .invoice-box { border: none; padding: 0; }
          .no-print { display: none; }
          .header h2 { font-size: 16px; }
        }
      </style>
    </head>
    <body>
      <div class="invoice-box">
        <div class="header">
          <h2>${STORE_NAME}</h2>
          <div class="sub">📅 ${dateStr} - 🕐 ${timeStr}</div>
          <div class="invoice-num">🧾 ${invoiceNumber}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>المنتج</th>
              <th>كم</th>
              <th>سعر</th>
              <th>إجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="total-row">
          <span>💰 الإجمالي</span>
          <span>${total.toFixed(2)} د.ع</span>
        </div>

        <div class="footer">
          <div>شكراً لتسوقكم 🛒</div>
          <div class="phone">${STORE_PHONE}</div>
          <div style="font-size:10px; color:#94a3b8; margin-top:4px;">طُبع بواسطة نظام POS</div>
        </div>
      </div>

      <div class="no-print">
        <button class="btn-print" onclick="window.print()">🖨️ طباعة</button>
        <button class="btn-close" onclick="window.close()">✖ إغلاق</button>
      </div>

      <script>
        const autoPrint = ${autoPrint};
        if (autoPrint) {
          setTimeout(() => {
            window.print();
          }, 500);
        }
      </script>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank', 'width=420,height=650');
  if (printWindow) {
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
  } else {
    alert('الرجاء السماح للنوافذ المنبثقة (Pop-ups) في المتصفح لتتمكن من الطباعة.');
  }
}

// ===== إتمام البيع =====
async function completeSale() {
  if (cart.length === 0) { showPosMessage('⚠️ الفاتورة فارغة', true); return; }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { showPosMessage('❌ يجب تسجيل الدخول أولاً', true); return; }

  const total = cart.reduce((sum, item) => sum + (item.unit_piece_price * item.quantity), 0);
  const invoiceId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const invoiceNumber = 'INV-' + Date.now();
  const now = new Date().toISOString();

  online = navigator.onLine;

  // حفظ الفاتورة محلياً
  const localInvoice = {
    id: invoiceId,
    tenant_id: currentTenantId,
    cashier_id: user.id,
    invoice_number: invoiceNumber,
    total_before_discount: total,
    discount_value: 0,
    final_total: total,
    status: 'completed',
    is_synced: online ? 1 : 0,
    created_at: now
  };
  await db.invoices.add(localInvoice);

  // حفظ البنود وتحديث المخزون محلياً
  for (const item of cart) {
    await db.invoice_items.add({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      invoice_id: invoiceId,
      product_id: item.id,
      unit_type: 'piece',
      quantity: item.quantity,
      unit_price: item.unit_piece_price,
      total_price: item.unit_piece_price * item.quantity
    });
    const newStock = item.stock_quantity - item.quantity;
    await db.products.update(item.id, { stock_quantity: newStock });
  }

  // قراءة خيارات الطباعة
  const printEnabled = document.getElementById('printCheckbox').checked;
  const autoPrint = document.getElementById('autoPrintCheckbox').checked;

  // المزامنة مع السحاب
  if (online) {
    try {
      const { data: supInv, error: invErr } = await supabaseClient
        .from('invoices')
        .insert({
          tenant_id: currentTenantId,
          cashier_id: user.id,
          invoice_number: invoiceNumber,
          total_before_discount: total,
          discount_value: 0,
          final_total: total,
          status: 'completed',
          is_synced: true
        })
        .select()
        .single();
      if (invErr) throw invErr;
      
      for (const item of cart) {
        await supabaseClient.from('invoice_items').insert({
          invoice_id: supInv.id,
          product_id: item.id,
          unit_type: 'piece',
          quantity: item.quantity,
          unit_price: item.unit_piece_price,
          total_price: item.unit_piece_price * item.quantity
        });
        const { data: prod } = await supabaseClient
          .from('products')
          .select('stock_quantity')
          .eq('id', item.id)
          .single();
        if (prod) {
          await supabaseClient
            .from('products')
            .update({ stock_quantity: prod.stock_quantity - item.quantity })
            .eq('id', item.id);
        }
      }
      await db.invoices.update(invoiceId, { is_synced: 1 });
      
      if (printEnabled || autoPrint) {
        printInvoice(invoiceNumber, cart, total);
        showPosMessage(`✅ تم إتمام البيع! 🎉 (تم فتح الطباعة)`, false);
      } else {
        showPosMessage(`✅ تم إتمام البيع! 🎉 رقم الفاتورة: ${invoiceNumber}`, false);
      }
      
    } catch (error) {
      console.error('❌ فشل المزامنة الفورية:', error);
      if (printEnabled || autoPrint) {
        printInvoice(invoiceNumber, cart, total);
        showPosMessage(`⚠️ تم حفظ البيع محلياً، سيتزامن تلقائياً. (تم فتح الطباعة)`, false);
      } else {
        showPosMessage(`⚠️ تم حفظ البيع محلياً، سيتزامن تلقائياً. رقم الفاتورة: ${invoiceNumber}`, false);
      }
    }
  } else {
    if (printEnabled || autoPrint) {
      printInvoice(invoiceNumber, cart, total);
      showPosMessage(`✅ تم إتمام البيع محلياً! 🎉 (تم فتح الطباعة)`, false);
    } else {
      showPosMessage(`✅ تم إتمام البيع محلياً! 🎉 رقم الفاتورة: ${invoiceNumber} (سيتزامن عند عودة النت)`, false);
    }
  }

  cart = [];
  renderCart();
  await loadProducts();
  await loadDashboardStats();
}

// ===== دوال التعديل والحذف =====
async function openEditModal(productId) {
  const modal = document.getElementById('editModal');
  modal.style.display = 'flex';
  let product;
  online = navigator.onLine;
  if (online) {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    if (!error && data) product = data;
  }
  if (!product) {
    product = await db.products.get(productId);
  }
  if (!product) {
    document.getElementById('editMsg').textContent = '❌ المنتج غير موجود';
    document.getElementById('editMsg').style.color = '#dc2626';
    return;
  }
  document.getElementById('editProductId').value = product.id;
  document.getElementById('editName').value = product.name_ar;
  document.getElementById('editBarcode').value = product.barcode || '';
  document.getElementById('editPurchasePrice').value = product.purchase_price || 0;
  document.getElementById('editPrice').value = product.unit_piece_price;
  document.getElementById('editStock').value = product.stock_quantity;
  document.getElementById('editMsg').textContent = '';
}

async function saveEditProduct() {
  const id = document.getElementById('editProductId').value;
  const name = document.getElementById('editName').value.trim();
  const barcode = document.getElementById('editBarcode').value.trim();
  const purchasePrice = parseFloat(document.getElementById('editPurchasePrice').value) || 0;
  const price = parseFloat(document.getElementById('editPrice').value) || 0;
  const stock = parseInt(document.getElementById('editStock').value) || 0;
  const msgDiv = document.getElementById('editMsg');
  if (!name) { msgDiv.textContent = '⚠️ اسم المنتج مطلوب'; msgDiv.style.color = '#dc2626'; return; }

  online = navigator.onLine;

  await db.products.update(id, {
    name_ar: name,
    barcode: barcode || null,
    purchase_price: purchasePrice,
    unit_piece_price: price,
    stock_quantity: stock
  });

  if (online) {
    const { error } = await supabaseClient
      .from('products')
      .update({
        name_ar: name,
        barcode: barcode || null,
        purchase_price: purchasePrice,
        unit_piece_price: price,
        stock_quantity: stock
      })
      .eq('id', id);
    if (error) {
      msgDiv.textContent = '⚠️ تم التعديل محلياً، فشل التعديل في السحاب: ' + error.message;
      msgDiv.style.color = '#f59e0b';
    } else {
      msgDiv.textContent = '✅ تم تعديل المنتج بنجاح!';
      msgDiv.style.color = '#16a34a';
    }
  } else {
    msgDiv.textContent = '✅ تم تعديل المنتج محلياً! سيتزامن عند عودة النت.';
    msgDiv.style.color = '#16a34a';
  }

  setTimeout(() => {
    document.getElementById('editModal').style.display = 'none';
    loadProducts();
    loadDashboardStats();
  }, 1000);
}

async function deleteProduct(productId, productName) {
  if (!confirm(`⚠️ هل أنت متأكد من حذف المنتج "${productName}"؟`)) return;

  online = navigator.onLine;

  const items = await db.invoice_items.where('product_id').equals(productId).toArray();
  if (items.length > 0) {
    const confirmDelete = confirm(
      `⚠️ تحذير: المنتج "${productName}" مرتبط بمبيعات سابقة.\n` +
      `سيتم حذف جميع سجلات المبيعات الخاصة بهذا المنتج نهائياً.\n` +
      `هل أنت متأكد من الاستمرار؟`
    );
    if (!confirmDelete) { showProductMessage('❌ تم إلغاء عملية الحذف.', true); return; }
    await db.invoice_items.where('product_id').equals(productId).delete();
  }

  await db.products.delete(productId);

  if (online) {
    try {
      await supabaseClient.from('invoice_items').delete().eq('product_id', productId);
      const { error } = await supabaseClient.from('products').delete().eq('id', productId);
      if (error) throw error;
      showProductMessage(`✅ تم حذف المنتج "${productName}" وجميع المبيعات المرتبطة به بنجاح!`, false);
    } catch (error) {
      showProductMessage(`⚠️ تم حذف المنتج محلياً، لكن فشل الحذف من السحاب: ${error.message}`, true);
    }
  } else {
    showProductMessage(`✅ تم حذف المنتج "${productName}" محلياً! سيتزامن عند عودة النت.`, false);
  }

  loadProducts();
  loadDashboardStats();
}

// ======================================================
// ===== دوال التقارير (مع الأرباح ونسبة الربح) =====
// ======================================================

function getDateRange(type, dateValue) {
  const now = new Date();
  let start = new Date();
  let end = new Date();
  let rangeLabel = '';

  if (type === 'today') {
    const todayStr = dateValue || now.toISOString().split('T')[0];
    start = new Date(todayStr + 'T00:00:00');
    end = new Date(todayStr + 'T23:59:59');
    rangeLabel = `اليوم: ${todayStr}`;
  } else if (type === 'month') {
    if (!dateValue) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      dateValue = `${y}-${m}`;
    }
    const [year, month] = dateValue.split('-').map(Number);
    start = new Date(year, month - 1, 1);
    end = new Date(year, month, 0, 23, 59, 59);
    rangeLabel = `الشهر: ${dateValue}`;
  } else if (type === 'last12') {
    start = new Date(now);
    start.setDate(start.getDate() - 365);
    end = new Date(now);
    rangeLabel = `آخر 12 شهراً (من ${start.toISOString().split('T')[0]} إلى ${end.toISOString().split('T')[0]})`;
  }

  return { start, end, rangeLabel };
}

async function loadReport() {
  const type = document.getElementById('reportType').value;
  const tbody = document.getElementById('reportTableBody');
  const foot = document.getElementById('reportTableFoot');
  const rangeSpan = document.getElementById('reportRange');
  const invoiceCountEl = document.getElementById('reportInvoiceCount');
  const totalSalesEl = document.getElementById('reportTotalSales');
  const averageEl = document.getElementById('reportAverage');
  const totalProfitEl = document.getElementById('reportTotalProfit');
  const profitPercentageEl = document.getElementById('reportProfitPercentage');

  let dateValue = '';
  if (type === 'today') {
    dateValue = document.getElementById('reportDate').value;
    if (!dateValue) {
      dateValue = new Date().toISOString().split('T')[0];
      document.getElementById('reportDate').value = dateValue;
    }
  } else if (type === 'month') {
    dateValue = document.getElementById('reportMonth').value;
    if (!dateValue) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      dateValue = `${y}-${m}`;
      document.getElementById('reportMonth').value = dateValue;
    }
  }

  const { start, end, rangeLabel } = getDateRange(type, dateValue);
  rangeSpan.textContent = rangeLabel;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#4f46e5; padding:20px;">
    <i class="fas fa-spinner fa-spin" style="font-size:24px; display:block; margin-bottom:10px;"></i>
    ⏳ جاري تحميل البيانات...
  </td></tr>`;
  foot.style.display = 'none';

  try {
    online = navigator.onLine;
    let invoices = [];

    // جلب الفواتير مع البنود وأسعار الشراء
    if (online) {
      const { data, error } = await supabaseClient
        .from('invoices')
        .select(`
          *,
          invoice_items (
            quantity,
            unit_price,
            total_price,
            products ( purchase_price )
          )
        `)
        .eq('tenant_id', currentTenantId)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false });
      if (!error && data) invoices = data;
      else {
        // إذا فشل السحاب، نستخدم المحلي
        invoices = await db.invoices
          .where('tenant_id')
          .equals(currentTenantId)
          .and(inv => inv.created_at >= start.toISOString() && inv.created_at <= end.toISOString())
          .toArray();
        for (const inv of invoices) {
          inv.invoice_items = await db.invoice_items.where('invoice_id').equals(inv.id).toArray();
          for (const item of inv.invoice_items) {
            const prod = await db.products.get(item.product_id);
            if (prod) item.products = { purchase_price: prod.purchase_price || 0 };
          }
        }
      }
    } else {
      invoices = await db.invoices
        .where('tenant_id')
        .equals(currentTenantId)
        .and(inv => inv.created_at >= start.toISOString() && inv.created_at <= end.toISOString())
        .toArray();
      for (const inv of invoices) {
        inv.invoice_items = await db.invoice_items.where('invoice_id').equals(inv.id).toArray();
        for (const item of inv.invoice_items) {
          const prod = await db.products.get(item.product_id);
          if (prod) item.products = { purchase_price: prod.purchase_price || 0 };
        }
      }
    }

    let reportData = [];
    let totalSales = 0;
    let totalProfit = 0;
    let totalItems = 0;

    if (type === 'today') {
      // عرض فواتير اليوم مع حساب الربح لكل فاتورة
      invoices.forEach((inv, index) => {
        let invProfit = 0;
        let invItems = 0;
        inv.invoice_items.forEach(item => {
          const purchasePrice = item.products?.purchase_price || 0;
          invProfit += (item.unit_price - purchasePrice) * item.quantity;
          invItems += item.quantity;
        });
        totalSales += inv.final_total;
        totalProfit += invProfit;
        totalItems += invItems;
        reportData.push({
          index: index + 1,
          invoice_number: inv.invoice_number,
          date: new Date(inv.created_at).toLocaleString('ar-EG'),
          items: invItems,
          total: inv.final_total,
          profit: invProfit
        });
      });
    } else {
      // تجميع حسب اليوم (للشهر أو آخر 12 شهراً)
      const grouped = {};
      invoices.forEach(inv => {
        const day = inv.created_at.split('T')[0];
        if (!grouped[day]) {
          grouped[day] = { total: 0, profit: 0, count: 0, items: 0 };
        }
        grouped[day].total += inv.final_total;
        grouped[day].count += 1;
        inv.invoice_items.forEach(item => {
          const purchasePrice = item.products?.purchase_price || 0;
          grouped[day].profit += (item.unit_price - purchasePrice) * item.quantity;
          grouped[day].items += item.quantity;
        });
      });

      const sortedDays = Object.keys(grouped).sort();
      reportData = sortedDays.map((day, index) => {
        const data = grouped[day];
        totalSales += data.total;
        totalProfit += data.profit;
        totalItems += data.items;
        return {
          index: index + 1,
          invoice_number: `-- (${data.count} فواتير) --`,
          date: day,
          items: data.items,
          total: data.total,
          profit: data.profit
        };
      });
    }

    // عرض البيانات في الجدول مع عمود الربح
    if (reportData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:30px;">
        <i class="fas fa-inbox" style="font-size:32px; display:block; margin-bottom:10px; color:#e2e8f0;"></i>
        لا توجد فواتير في هذه الفترة
      </td></tr>`;
      foot.style.display = 'none';
    } else {
      tbody.innerHTML = reportData.map(row => `
        <tr>
          <td>${row.index}</td>
          <td><span class="badge">${row.invoice_number}</span></td>
          <td>${row.date}</td>
          <td>${row.items}</td>
          <td><strong>${row.total.toFixed(2)} د.ع</strong></td>
          <td style="color: ${row.profit >= 0 ? '#16a34a' : '#dc2626'}; font-weight:600;">${row.profit.toFixed(2)} د.ع</td>
        </tr>
      `).join('');

      // إضافة صف الإجمالي
      document.getElementById('footerTotalItems').textContent = totalItems;
      document.getElementById('footerTotalSales').textContent = totalSales.toFixed(2);
      document.getElementById('footerTotalProfit').textContent = totalProfit.toFixed(2);
      foot.style.display = 'table-footer-group';
    }

    // تحديث بطاقات الملخص
    invoiceCountEl.textContent = invoices.length;
    totalSalesEl.textContent = totalSales.toFixed(2);
    const avg = invoices.length > 0 ? (totalSales / invoices.length) : 0;
    averageEl.textContent = avg.toFixed(2);

    // ===== حساب وعرض إجمالي الربح ونسبة الربح =====
    totalProfitEl.textContent = totalProfit.toFixed(2);
    const profitPercentage = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
    profitPercentageEl.textContent = profitPercentage.toFixed(2) + '%';

  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#dc2626; padding:20px;">
      ❌ حدث خطأ أثناء تحميل البيانات: ${error.message}
    </td></tr>`;
    foot.style.display = 'none';
  }
}

// ===== ربط الأزرار =====
document.addEventListener('DOMContentLoaded', function() {
  updateConnectionStatus();

  document.getElementById('loginFormBtn').addEventListener('click', handleLogin);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', function() { navigateTo(this.dataset.section); });
  });
  document.getElementById('backToMenuBtn').addEventListener('click', goHome);
  document.getElementById('addProductBtn').addEventListener('click', addProduct);
  document.getElementById('addToInvoiceBtn').addEventListener('click', addToInvoice);
  document.getElementById('completeSaleBtn').addEventListener('click', completeSale);
  document.getElementById('clearCartBtn').addEventListener('click', clearCart);
  
  document.getElementById('barcodeScanner').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addToInvoice(); }
  });
  document.getElementById('productNameSearch').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addToInvoice(); }
  });

  document.getElementById('cartItems').addEventListener('click', function(e) {
    const target = e.target;
    if (target.classList.contains('qty-btn')) {
      const productId = target.dataset.id;
      const action = target.dataset.action;
      if (action === 'increase') increaseQuantity(productId);
      else if (action === 'decrease') decreaseQuantity(productId);
    }
  });

  document.getElementById('saveEditBtn').addEventListener('click', saveEditProduct);
  document.getElementById('closeEditModalBtn').addEventListener('click', function() {
    document.getElementById('editModal').style.display = 'none';
  });
  document.getElementById('editModal').addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });

  document.getElementById('loadReportBtn').addEventListener('click', loadReport);
  document.getElementById('reportType').addEventListener('change', function() {
    const type = this.value;
    document.getElementById('dateField').style.display = (type === 'today') ? 'block' : 'none';
    document.getElementById('monthField').style.display = (type === 'month') ? 'block' : 'none';
    if (type === 'last12') {
      document.getElementById('dateField').style.display = 'none';
      document.getElementById('monthField').style.display = 'none';
    }
  });

  document.getElementById('exportReportBtn').addEventListener('click', function() {
    const tbody = document.getElementById('reportTableBody');
    const foot = document.getElementById('reportTableFoot');
    const rangeSpan = document.getElementById('reportRange').textContent;
    
    const rows = tbody.querySelectorAll('tr');
    if (!rows.length || rows[0].cells.length < 2) {
      alert('⚠️ لا توجد بيانات لتصديرها. قم بتحميل التقرير أولاً.');
      return;
    }
    const firstCell = rows[0].cells[0]?.textContent || '';
    if (firstCell.includes('لا توجد فواتير') || firstCell.includes('جاري تحميل')) {
      alert('⚠️ لا توجد بيانات حقيقية لتصديرها. قم بتحميل التقرير أولاً.');
      return;
    }

    const btn = this;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التصدير...';
    btn.disabled = true;

    try {
      const excelData = [];
      excelData.push(['تقرير المبيعات', '']);
      excelData.push(['الفترة:', rangeSpan]);
      excelData.push([]);
      const headers = ['#', 'رقم الفاتورة', 'التاريخ', 'عدد المنتجات', 'الإجمالي (د.ع)', 'الربح (د.ع)'];
      excelData.push(headers);

      rows.forEach(row => {
        const rowData = [];
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
          let text = cell.textContent.trim();
          text = text.replace(/\*\*/g, '').trim();
          rowData.push(text);
        });
        if (rowData.length >= 6 && !rowData[0].includes('لا توجد')) {
          excelData.push(rowData);
        }
      });

      const footRows = foot.querySelectorAll('tr');
      if (footRows.length > 0) {
        const footData = [];
        const footCells = footRows[0].querySelectorAll('td');
        footCells.forEach(cell => {
          footData.push(cell.textContent.trim());
        });
        if (footData.length >= 6) {
          excelData.push([]);
          excelData.push(['الإجمالي الكلي', '', '', footData[0] || '0', footData[1] || '0.00', footData[2] || '0.00']);
        }
      }

      if (typeof XLSX === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';
        script.onload = function() {
          document.getElementById('exportReportBtn').click();
        };
        document.head.appendChild(script);
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(excelData);
      ws['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, 'المبيعات');
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const fileName = `تقرير_المبيعات_${dateStr}.xlsx`;
      XLSX.writeFile(wb, fileName);
      alert(`✅ تم تصدير التقرير بنجاح!\n📁 اسم الملف: ${fileName}`);
    } catch (error) {
      console.error(error);
      alert('❌ حدث خطأ أثناء تصدير الملف: ' + error.message);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // ===== تسجيل Service Worker للعمل بدون إنترنت =====
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js')
        .then(function(registration) {
          console.log('✅ Service Worker مسجل بنجاح:', registration);
        })
        .catch(function(error) {
          console.log('❌ فشل تسجيل Service Worker:', error);
        });
    });
  }

  (async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      document.getElementById('loginPage').style.display = 'none';
      document.getElementById('mainApp').style.display = 'block';
      await loadUserProfile();
      await loadDashboardStats();
      await loadProducts();
      goHome();
      updateConnectionStatus();
      if (online) {
        setTimeout(() => {
          syncPendingInvoices();
          syncPendingProducts();
        }, 3000);
      }
    }
  })();
});
