// ================== IndexedDB Open ==================
let db;
const request = indexedDB.open('schoolInventory', 4);

// ---------- Firebase Config (from you) ----------
const firebaseConfig = {
  apiKey: "AIzaSyAPiJHMYJzQdRh0XrE42803BaT7jzGuZ9A",
  authDomain: "school-stock.firebaseapp.com",
  projectId: "school-stock",
  storageBucket: "school-stock.firebasestorage.app",
  messagingSenderId: "644388078816",
  appId: "1:644388078816:web:e3fbb702c9a094032d3c85",
  measurementId: "G-PN72JHLB5M"
};

// ---------- Globals ----------
let firebaseEnabled = false;
let firestore = null;
const CLIENT_ID_KEY = 'schoolInventory_clientId';
let CLIENT_ID = localStorage.getItem(CLIENT_ID_KEY);
if (!CLIENT_ID) {
  CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(CLIENT_ID_KEY, CLIENT_ID);
}

// ================== Firebase Init ==================
function initFirebase() {
  try {
    if (window.firebase && firebase.apps && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    if (window.firebase && firebase.apps && firebase.apps.length) {
      firestore = firebase.firestore();
      firebaseEnabled = true;
      setFirebaseStatus('Firebase (Firestore) සබඳතාව සක්‍රීයයි — දත්ත Firestore වෙත සකසන ලැබේ');
      startLivePull(); // 🔴 start real-time pull AFTER init
    } else {
      setFirebaseStatus('Firebase SDK නොපවතී — CDN script ඇතුළත් කරලා නැද්ද බලන්න.');
    }
  } catch (err) {
    console.error('Firebase init error:', err);
    setFirebaseStatus('Firebase සවිකිරීමේ දෝෂයක්: ' + (err?.message || err));
  }
}

function setFirebaseStatus(text) {
  const el = document.getElementById('firebaseStatus');
  if (el) el.textContent = 'Firebase සම්බන්ධතා තත්ත්වය: ' + text;
}

// ================== IDB Schema ==================
request.onupgradeneeded = function (event) {
  db = event.target.result;

  if (!db.objectStoreNames.contains('inventory')) {
    const store = db.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
    store.createIndex('itemDescription', 'itemDescription', { unique: true });
  }
  if (!db.objectStoreNames.contains('distribution')) {
    const distributionStore = db.createObjectStore('distribution', { keyPath: 'id', autoIncrement: true });
    distributionStore.createIndex('itemId', 'itemId');
  }
  if (!db.objectStoreNames.contains('purchaseHistory')) {
    const purchaseHistoryStore = db.createObjectStore('purchaseHistory', { keyPath: 'id', autoIncrement: true });
    purchaseHistoryStore.createIndex('itemId', 'itemId');
  }
};

request.onsuccess = function (event) {
  db = event.target.result;
  initFirebase();   // 🔵 connect Firebase
  loadInventory();  // render UI
};

request.onerror = function (event) {
  console.error('IndexedDB error:', event);
};

// ================== Helpers ==================
function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = e => reject(e.target.error);
  });
}

function putToStore(storeName, obj) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(obj);
    req.onsuccess = () => resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}

function deleteFromStore(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}

// ================== Local -> Firestore Sync ==================
async function syncToFirebase() {
  if (!firebaseEnabled || !firestore) return;

  try {
    const [inventory, purchaseHistory, distribution] = await Promise.all([
      getAllFromStore('inventory'),
      getAllFromStore('purchaseHistory'),
      getAllFromStore('distribution')
    ]);

    // inventory
    let batch = firestore.batch();
    inventory.forEach(item => {
      const ref = firestore.collection('inventory').doc(String(item.id));
      batch.set(ref, { ...item, _clientId: CLIENT_ID, _updatedAt: Date.now() }, { merge: true });
    });
    await batch.commit();

    // purchaseHistory
    batch = firestore.batch();
    purchaseHistory.forEach(h => {
      const ref = firestore.collection('purchaseHistory').doc(String(h.id));
      batch.set(ref, { ...h, _clientId: CLIENT_ID, _updatedAt: Date.now() }, { merge: true });
    });
    await batch.commit();

    // distribution
    if (distribution && distribution.length) {
      batch = firestore.batch();
      distribution.forEach(d => {
        const ref = firestore.collection('distribution').doc(String(d.id));
        batch.set(ref, { ...d, _clientId: CLIENT_ID, _updatedAt: Date.now() }, { merge: true });
      });
      await batch.commit();
    }

    await firestore.collection('_meta').doc('schoolInventory').set({
      lastSyncedAt: new Date().toISOString(),
      _clientId: CLIENT_ID
    }, { merge: true });

    setFirebaseStatus('දත්ත Firestore වෙත සාර්ථකව යවා ඇත (' + new Date().toLocaleString() + ')');
  } catch (err) {
    console.error('Firestore write error:', err);
    setFirebaseStatus('Firestore ලිවීමේ දෝෂයක්: ' + (err?.message || err));
  }
}

// debounce sync
function scheduleSync() {
  if (window.__syncTimeout) clearTimeout(window.__syncTimeout);
  window.__syncTimeout = setTimeout(syncToFirebase, 600);
}

// ================== Firestore -> Local Live Pull ==================
let unsubscribes = [];
function startLivePull() {
  if (!firebaseEnabled || !firestore) return;

  const debouncedUIRefresh = debounce(() => {
    loadInventory();
  }, 300);

  // Helper to bind a collection to a store
  function bind(colName, storeName) {
    const unsub = firestore.collection(colName).onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const data = change.doc.data() || {};
        // Avoid echo: ignore docs we just wrote from THIS client
        if (data._clientId && data._clientId === CLIENT_ID) return;

        const id = parseInt(change.doc.id, 10);
        // If id is not a number, skip (we rely on numeric IDs)
        if (Number.isNaN(id)) return;

        if (change.type === 'removed') {
          deleteFromStore(storeName, id).then(debouncedUIRefresh);
        } else {
          // Normalize: ensure 'id' field exists for our IDB schema
          const obj = { ...data, id };
          putToStore(storeName, obj).then(debouncedUIRefresh);
        }
      });
    }, err => {
      console.error(`onSnapshot error (${colName}):`, err);
    });

    unsubscribes.push(unsub);
  }

  bind('inventory', 'inventory');
  bind('purchaseHistory', 'purchaseHistory');
  bind('distribution', 'distribution');

  // Clean up on page close
  window.addEventListener('beforeunload', () => {
    unsubscribes.forEach(u => { try { u(); } catch {} });
    unsubscribes = [];
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

// ================== UI & Actions ==================
let editingId = null;

document.getElementById('inventoryForm').addEventListener('submit', function (event) {
  event.preventDefault();

  const itemDescription = document.getElementById('itemDescription').value;
  const stockPage = document.getElementById('stockPage').value;
  const purchaseDate = document.getElementById('purchaseDate').value;
  const invoiceNumber = document.getElementById('invoiceNumber').value;
  const receiptNumber = document.getElementById('receiptNumber').value;
  const supplierName = document.getElementById('supplierName').value;
  const quantityReceived = parseInt(document.getElementById('quantityReceived').value) || 0;
  const quantityIssued = parseInt(document.getElementById('quantityIssued').value) || 0;

  const transaction = db.transaction(['inventory', 'purchaseHistory'], 'readwrite');
  const store = transaction.objectStore('inventory');
  const purchaseHistoryStore = transaction.objectStore('purchaseHistory');

  if (editingId) {
    const getRequest = store.get(editingId);
    getRequest.onsuccess = function (e) {
      const existingItem = e.target.result;
      const newRemainingQuantity = (existingItem.remainingQuantity || 0) + quantityReceived;

      const item = {
        id: editingId,
        itemDescription,
        stockPage,
        purchaseDate,
        invoiceNumber,
        receiptNumber,
        supplierName,
        quantityReceived: (existingItem.quantityReceived || 0) + quantityReceived,
        quantityIssued: existingItem.quantityIssued || 0,
        remainingQuantity: newRemainingQuantity
      };

      const updateRequest = store.put(item);
      updateRequest.onsuccess = function () {
        const purchaseHistory = {
          id: undefined,
          itemId: editingId,
          purchaseDate,
          quantityReceived,
          supplierName,
          invoiceNumber
        };
        purchaseHistoryStore.add(purchaseHistory);

        loadInventory();
        document.getElementById('inventoryForm').reset();
        editingId = null;
        scheduleSync(); // push to Firestore
      };
    };
  } else {
    const item = {
      itemDescription,
      stockPage,
      purchaseDate,
      invoiceNumber,
      receiptNumber,
      supplierName,
      quantityReceived,
      quantityIssued: quantityIssued || 0,
      remainingQuantity: quantityReceived
    };

    const addRequest = store.add(item);
    addRequest.onerror = function (e) {
      if (e.target.error.name === 'ConstraintError') {
        alert('අයිතමය දැනටමත් පවතී. කරුණාකර වෙනත් විස්තරයක් භාවිතා කරන්න.');
      }
    };
    addRequest.onsuccess = function (e) {
      const itemId = e.target.result;
      const purchaseHistory = {
        id: undefined,
        itemId,
        purchaseDate,
        quantityReceived,
        supplierName,
        invoiceNumber
      };
      purchaseHistoryStore.add(purchaseHistory);

      loadInventory();
      document.getElementById('inventoryForm').reset();
      scheduleSync();
    };
  }
});

function loadInventory() {
  const transaction = db.transaction(['inventory'], 'readonly');
  const store = transaction.objectStore('inventory');
  const request = store.getAll();

  request.onsuccess = function (event) {
    const inventory = event.target.result || [];
    const tableBody = document.querySelector('#inventoryTable tbody');
    tableBody.innerHTML = '';
    inventory.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.itemDescription || ''}</td>
        <td>${item.stockPage || ''}</td>
        <td>${item.purchaseDate || ''}</td>
        <td>${item.invoiceNumber || ''}</td>
        <td>${item.receiptNumber || ''}</td>
        <td>${item.supplierName || ''}</td>
        <td>${item.quantityReceived || 0}</td>
        <td>${item.quantityIssued || 0}</td>
        <td>${item.remainingQuantity || 0}</td>
        <td>
          <button onclick="editItem(${item.id})">සංස්කරණය</button>
          <button onclick="deleteItem(${item.id})">ඉවත් කරන්න</button>
          <button onclick="distributeItem(${item.id})">බෙදාහැරීම</button>
          <button onclick="showPurchaseHistory(${item.id})">මිලදී ගැනීම් ඉතිහාසය</button>
        </td>
      `;
      tableBody.appendChild(row);
    });
    updateAllDistributionHistory();
  };
}

function showPurchaseHistory(itemId) {
  const tx = db.transaction(['purchaseHistory'], 'readonly');
  const store = tx.objectStore('purchaseHistory');
  const index = store.index('itemId');
  const req = index.getAll(itemId);

  req.onsuccess = function (e) {
    const purchaseHistory = e.target.result || [];
    let historyHTML = '<h3>මිලදී ගැනීම් ඉතිහාසය</h3>';
    if (purchaseHistory.length > 0) {
      historyHTML += '<ul>';
      purchaseHistory.forEach(p => {
        historyHTML += `<li>දිනය: ${p.purchaseDate}, ප්‍රමාණය: ${p.quantityReceived}, සැපයුම්කරු: ${p.supplierName}, ඉන්වොයිස් අංකය: ${p.invoiceNumber}</li>`;
      });
      historyHTML += '</ul>';
    } else {
      historyHTML += '<p>මිලදී ගැනීම් ඉතිහාසයක් නොමැත.</p>';
    }
    document.getElementById('purchaseHistory').innerHTML = historyHTML;
  };
}

function distributeItem(id) {
  const recipient = prompt("ලබන්නාගේ නම ඇතුළත් කරන්න:");
  const quantity = parseInt(prompt("බෙදාහරින ප්‍රමාණය ඇතුළත් කරන්න:"));
  const date = prompt("දිනය ඇතුළත් කරන්න (YYYY-MM-DD):");

  if (recipient && quantity && date) {
    const tx = db.transaction(['inventory', 'distribution'], 'readwrite');
    const inventoryStore = tx.objectStore('inventory');
    const distributionStore = tx.objectStore('distribution');

    const getReq = inventoryStore.get(id);
    getReq.onsuccess = function (e) {
      const item = e.target.result;

      if ((item.remainingQuantity || 0) >= quantity) {
        item.quantityIssued = (item.quantityIssued || 0) + quantity;
        item.remainingQuantity = (item.remainingQuantity || 0) - quantity;
        inventoryStore.put(item);

        const distribution = { id: undefined, itemId: id, recipient, quantity, date };
        distributionStore.add(distribution);

        loadInventory();
        alert("අයිතමය සාර්ථකව බෙදාහරින ලදී.");
        scheduleSync();
      } else {
        alert("ප්‍රමාණවත් තොගයක් නොමැත.");
      }
    };
  }
}

function editItem(id) {
  const tx = db.transaction(['inventory'], 'readonly');
  const store = tx.objectStore('inventory');
  const req = store.get(id);

  req.onsuccess = function (e) {
    const item = e.target.result;
    document.getElementById('itemDescription').value = item.itemDescription || '';
    document.getElementById('stockPage').value = item.stockPage || '';
    document.getElementById('purchaseDate').value = item.purchaseDate || '';
    document.getElementById('invoiceNumber').value = item.invoiceNumber || '';
    document.getElementById('receiptNumber').value = item.receiptNumber || '';
    document.getElementById('supplierName').value = item.supplierName || '';
    document.getElementById('quantityReceived').value = 0;
    document.getElementById('quantityIssued').value = item.quantityIssued || 0;
    editingId = id;
  };
}

async function deleteItem(id) {
  if (!confirm('ඔබට මෙම අයිතමය ඉවත් කිරීමට අවශ්‍ය බව විශ්වාසද?')) return;

  const tx = db.transaction(['inventory'], 'readwrite');
  const store = tx.objectStore('inventory');
  const req = store.delete(id);

  req.onsuccess = async function () {
    loadInventory();
    if (firebaseEnabled && firestore) {
      try {
        await firestore.collection('inventory').doc(String(id)).delete();
      } catch (e) {
        console.warn('Firestore delete warning:', e?.message);
      }
    }
    scheduleSync();
  };
}

document.getElementById('search').addEventListener('input', function () {
  const searchValue = this.value.toLowerCase();
  const rows = document.querySelectorAll('#inventoryTable tbody tr');
  rows.forEach(row => {
    const itemDescription = row.querySelector('td:first-child').textContent.toLowerCase();
    if (itemDescription.includes(searchValue)) {
      row.style.display = '';
      const itemId = row.querySelector('button[onclick^="editItem"]').getAttribute('onclick').match(/\d+/)[0];
      fetchAndDisplayDistributionHistory(itemId, row);
    } else {
      row.style.display = 'none';
      row.querySelector('.distribution-history')?.remove();
    }
  });
  document.getElementById('purchaseHistory').innerHTML = '';
});

function fetchAndDisplayDistributionHistory(itemId, row) {
  const tx = db.transaction(['distribution'], 'readonly');
  const store = tx.objectStore('distribution');
  const index = store.index('itemId');
  const req = index.getAll(parseInt(itemId));

  req.onsuccess = function (e) {
    const distributions = e.target.result || [];
    let historyHTML = '<div class="distribution-history">';
    if (distributions.length > 0) {
      historyHTML += '<h4>බෙදාහැරීම් ඉතිහාසය:</h4><ul>';
      distributions.forEach(dist => {
        historyHTML += `<li><strong>${dist.recipient}</strong> - ${dist.quantity} ඒකක ${dist.date} දින</li>`;
      });
      historyHTML += '</ul>';
    } else {
      historyHTML += '<p>මෙම අයිතමය සඳහා බෙදාහැරීම් නොමැත.</p>';
    }
    historyHTML += '</div>';
    row.querySelector('.distribution-history')?.remove();
    const lastCell = row.querySelector('td:last-child');
    lastCell.insertAdjacentHTML('beforeend', historyHTML);
  };
}

function updateAllDistributionHistory() {
  const rows = document.querySelectorAll('#inventoryTable tbody tr');
  rows.forEach(row => {
    const itemId = row.querySelector('button[onclick^="editItem"]').getAttribute('onclick').match(/\d+/)[0];
    fetchAndDisplayDistributionHistory(itemId, row);
  });
}

// ================== Print / Backup / Restore ==================
function printInventory() {
  window.print();
}

function exportBackup() {
  const backupData = {};
  const tx = db.transaction(['inventory', 'purchaseHistory', 'distribution'], 'readonly');
  const inventoryStore = tx.objectStore('inventory');
  const purchaseHistoryStore = tx.objectStore('purchaseHistory');
  const distributionStore = tx.objectStore('distribution');

  inventoryStore.getAll().onsuccess = function (e) {
    backupData.inventory = e.target.result || [];
    purchaseHistoryStore.getAll().onsuccess = function (e2) {
      backupData.purchaseHistory = e2.target.result || [];
      distributionStore.getAll().onsuccess = function (e3) {
        backupData.distribution = e3.target.result || [];

        const jsonString = JSON.stringify(backupData);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        const date = new Date().toISOString().split('T')[0];
        link.download = `inventory_backup_${date}.json`;
        link.click();
      };
    };
  };
}

function importBackup(event) {
  const file = event.target.files[0];
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const tx = db.transaction(['inventory', 'purchaseHistory', 'distribution'], 'readwrite');
      const inventoryStore = tx.objectStore('inventory');
      const purchaseHistoryStore = tx.objectStore('purchaseHistory');
      const distributionStore = tx.objectStore('distribution');

      inventoryStore.clear();
      purchaseHistoryStore.clear();
      distributionStore.clear();

      let addedInventoryCount = 0;
      let addedPurchaseHistoryCount = 0;
      let addedDistributionCount = 0;

      (data.inventory || []).forEach(item => {
        inventoryStore.add(item).onsuccess = function () {
          addedInventoryCount++; checkCompletion();
        };
      });

      (data.purchaseHistory || []).forEach(history => {
        purchaseHistoryStore.add(history).onsuccess = function () {
          addedPurchaseHistoryCount++; checkCompletion();
        };
      });

      (data.distribution || []).forEach(dist => {
        distributionStore.add(dist).onsuccess = function () {
          addedDistributionCount++; checkCompletion();
        };
      });

      function checkCompletion() {
        const totalExpected =
          (data.inventory?.length || 0) +
          (data.purchaseHistory?.length || 0) +
          (data.distribution?.length || 0);

        const totalAdded = addedInventoryCount + addedPurchaseHistoryCount + addedDistributionCount;

        if (totalAdded === totalExpected) {
          loadInventory();
          alert('දත්ත සාර්ථකව ප්‍රතිස්ථාපනය කරන ලදී.');
          scheduleSync(); // push restored data to Firestore
        }
      }
    } catch (error) {
      console.error('Error during restore:', error);
      alert('දත්ත ප්‍රතිස්ථාපනය කිරීමේදී දෝෂයක්. වලංගු backup ගොනුවක් තෝරන්න.');
    }
  };

  reader.readAsText(file);
}
