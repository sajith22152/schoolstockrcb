let db;
const request = indexedDB.open('schoolInventory', 4);

/* ========= 1) FIREBASE CONFIG =========
   ⚠️ මෙහි ඔබගේ Firebase config දාන්න (Project settings -> General -> Your apps -> SDK setup and configuration)
*/
const firebaseConfig = {
  apiKey: "AIzaSyAPiJHMYJzQdRh0XrE42803BaT7jzGuZ9A",
  authDomain: "school-stock.firebaseapp.com",
  projectId: "school-stock",        // Firestore ඉතාම වැදගත්
  storageBucket: "school-stock.firebasestorage.app",
  messagingSenderId: "644388078816",
  appId: "1:644388078816:web:e3fbb702c9a094032d3c85"
};

let firebaseEnabled = false;
let firestore = null;

// ========= 2) Initialize Firebase + Firestore =========
function initFirebase() {
  try {
    if (window.firebase && firebase.apps && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    if (window.firebase && firebase.apps && firebase.apps.length) {
      firestore = firebase.firestore();
      firebaseEnabled = true;
      setFirebaseStatus('Firebase (Firestore) සබඳතාව සක්‍රීයයි — දත්ත Firestore වෙත සකසන ලැබේ');
    } else {
      setFirebaseStatus('Firebase SDK නොපවතී — CDN script ඇතුළත් කරලා නැද්ද බලන්න.');
    }
  } catch (err) {
    console.error('Firebase init error:', err);
    setFirebaseStatus('Firebase සවිකිරීමේ දෝෂයක්: ' + err.message);
  }
}

function setFirebaseStatus(text) {
  const el = document.getElementById('firebaseStatus');
  if (el) el.textContent = 'Firebase සම්බන්ධතා තත්ත්වය: ' + text;
}

/* ========= 3) IndexedDB schema =========
   (ඔරിജිනල් කේතයේම වගේ — inventory / distribution / purchaseHistory stores) */
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
  initFirebase();       // Firestore init
  loadInventory();      // UI populate
};

request.onerror = function (event) {
  console.error('IndexedDB error:', event);
};

// helper: getAll from store as Promise
function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = e => reject(e.target.error);
  });
}

/* ========= 4) SYNC to Firestore =========
   Local IndexedDB -> Firestore collections:
   - inventory
   - purchaseHistory
   - distribution
*/
async function syncToFirebase() {
  if (!firebaseEnabled || !firestore) return;

  try {
    const [inventory, purchaseHistory, distribution] = await Promise.all([
      getAllFromStore('inventory'),
      getAllFromStore('purchaseHistory'),
      getAllFromStore('distribution')
    ]);

    // inventory (batch upsert)
    let batch = firestore.batch();
    inventory.forEach(item => {
      const ref = firestore.collection('inventory').doc(String(item.id));
      batch.set(ref, item, { merge: true });
    });
    await batch.commit();

    // purchaseHistory
    batch = firestore.batch();
    purchaseHistory.forEach(h => {
      const ref = firestore.collection('purchaseHistory').doc(String(h.id));
      batch.set(ref, h, { merge: true });
    });
    await batch.commit();

    // distribution
    if (distribution && distribution.length) {
      batch = firestore.batch();
      distribution.forEach(d => {
        const ref = firestore.collection('distribution').doc(String(d.id));
        batch.set(ref, d, { merge: true });
      });
      await batch.commit();
    }

    // meta
    await firestore.collection('_meta').doc('schoolInventory').set({
      lastSyncedAt: new Date().toISOString()
    }, { merge: true });

    setFirebaseStatus('දත්ත Firestore වෙත සාර්ථකව යවා ඇත (' + new Date().toLocaleString() + ')');
  } catch (err) {
    console.error('Firestore write error:', err);
    setFirebaseStatus('Firestore ලිවීමේ දෝෂයක්: ' + err.message);
  }
}

// small debounce to avoid excessive writes
function scheduleSync() {
  if (window.__syncTimeout) clearTimeout(window.__syncTimeout);
  window.__syncTimeout = setTimeout(() => {
    syncToFirebase();
  }, 600);
}

let editingId = null;

/* ========= 5) FORM submit (Add / Update) =========
   (ඔරিজිනල් logic එක රැස් කරලා — Firestore sync එක scheduleSync() හරහා) */
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
    // Update existing item
    const getRequest = store.get(editingId);
    getRequest.onsuccess = function (e) {
      const existingItem = e.target.result;
      const newRemainingQuantity = existingItem.remainingQuantity + quantityReceived;

      const item = {
        id: editingId,
        itemDescription,
        stockPage,
        purchaseDate,
        invoiceNumber,
        receiptNumber,
        supplierName,
        quantityReceived: existingItem.quantityReceived + quantityReceived,
        quantityIssued: existingItem.quantityIssued,
        remainingQuantity: newRemainingQuantity
      };

      const updateRequest = store.put(item);
      updateRequest.onsuccess = function () {
        // Add purchase history
        const purchaseHistory = {
          id: undefined,                 // auto-increment by IDB
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
        scheduleSync();
      };
    };
  } else {
    // New item
    const item = {
      itemDescription,
      stockPage,
      purchaseDate,
      invoiceNumber,
      receiptNumber,
      supplierName,
      quantityReceived,
      quantityIssued: 0,
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

/* ========= 6) Load + Table render ========= */
function loadInventory() {
  const transaction = db.transaction(['inventory'], 'readonly');
  const store = transaction.objectStore('inventory');
  const request = store.getAll();

  request.onsuccess = function (event) {
    const inventory = event.target.result;
    const tableBody = document.querySelector('#inventoryTable tbody');
    tableBody.innerHTML = '';
    inventory.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.itemDescription}</td>
        <td>${item.stockPage}</td>
        <td>${item.purchaseDate}</td>
        <td>${item.invoiceNumber}</td>
        <td>${item.receiptNumber}</td>
        <td>${item.supplierName}</td>
        <td>${item.quantityReceived}</td>
        <td>${item.quantityIssued}</td>
        <td>${item.remainingQuantity}</td>
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
    scheduleSync(); // Firestore sync after (re)render
  };
}

/* ========= 7) Purchase history panel ========= */
function showPurchaseHistory(itemId) {
  const tx = db.transaction(['purchaseHistory'], 'readonly');
  const store = tx.objectStore('purchaseHistory');
  const index = store.index('itemId');
  const req = index.getAll(itemId);

  req.onsuccess = function (e) {
    const purchaseHistory = e.target.result;
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

/* ========= 8) Distribute ========= */
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

      if (item.remainingQuantity >= quantity) {
        item.quantityIssued += quantity;
        item.remainingQuantity -= quantity;
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

/* ========= 9) Edit / Delete ========= */
function editItem(id) {
  const tx = db.transaction(['inventory'], 'readonly');
  const store = tx.objectStore('inventory');
  const req = store.get(id);

  req.onsuccess = function (e) {
    const item = e.target.result;
    document.getElementById('itemDescription').value = item.itemDescription;
    document.getElementById('stockPage').value = item.stockPage;
    document.getElementById('purchaseDate').value = item.purchaseDate;
    document.getElementById('invoiceNumber').value = item.invoiceNumber;
    document.getElementById('receiptNumber').value = item.receiptNumber;
    document.getElementById('supplierName').value = item.supplierName;
    document.getElementById('quantityReceived').value = 0;  // new purchases only
    document.getElementById('quantityIssued').value = item.quantityIssued;
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
    // Firestore වලින්ත් ඉවත් කරමු (ගැලපෙන්නේ docId = local id)
    if (firebaseEnabled && firestore) {
      try {
        await firestore.collection('inventory').doc(String(id)).delete();
      } catch (e) {
        // silent; next full sync එකෙන් state align වෙයි
        console.warn('Firestore delete warning:', e?.message);
      }
    }
    scheduleSync();
  };
}

/* ========= 10) Search + distribution history display ========= */
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
    const distributions = e.target.result;
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

/* ========= 11) Print / Backup / Restore ========= */
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
    backupData.inventory = e.target.result;
    purchaseHistoryStore.getAll().onsuccess = function (e2) {
      backupData.purchaseHistory = e2.target.result;
      distributionStore.getAll().onsuccess = function (e3) {
        backupData.distribution = e3.target.result;

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

      data.inventory.forEach(item => {
        inventoryStore.add(item).onsuccess = function () {
          addedInventoryCount++; checkCompletion();
        };
      });

      data.purchaseHistory.forEach(history => {
        purchaseHistoryStore.add(history).onsuccess = function () {
          addedPurchaseHistoryCount++; checkCompletion();
        };
      });

      if (data.distribution && data.distribution.length > 0) {
        data.distribution.forEach(dist => {
          distributionStore.add(dist).onsuccess = function () {
            addedDistributionCount++; checkCompletion();
          };
        });
      } else {
        addedDistributionCount = 0;
      }

      function checkCompletion() {
        const totalExpected = data.inventory.length + data.purchaseHistory.length + (data.distribution ? data.distribution.length : 0);
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

function updateAllDistributionHistory() {
  const rows = document.querySelectorAll('#inventoryTable tbody tr');
  rows.forEach(row => {
    const itemId = row.querySelector('button[onclick^="editItem"]').getAttribute('onclick').match(/\d+/)[0];
    fetchAndDisplayDistributionHistory(itemId, row);
  });
}
