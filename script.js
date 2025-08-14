// IndexedDB setup
let db;
const request = indexedDB.open('schoolInventory', 1);

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyAPiJHMYJzQdRh0XrE42803BaT7jzGuZ9A",
  authDomain: "school-stock.firebaseapp.com",
  databaseURL: "https://school-stock.firebaseio.com",
  projectId: "school-stock",
  storageBucket: "school-stock.firebasestorage.app",
  messagingSenderId: "644388078816",
  appId: "1:644388078816:web:e3fbb702c9a094032d3c85",
  measurementId: "G-PN72JHLB5M"
};

let firebaseRootRef = null;

function initFirebase() {
    firebase.initializeApp(firebaseConfig);
    firebaseRootRef = firebase.database().ref('schoolInventory');
    document.getElementById('firebaseStatus').textContent = 'Firebase connected';
}

request.onupgradeneeded = function(e) {
    db = e.target.result;
    if (!db.objectStoreNames.contains('inventory')) {
        db.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
    }
};

request.onsuccess = function(e) {
    db = e.target.result;
    initFirebase();
};

// Add / Update inventory
document.getElementById('inventoryForm').addEventListener('submit', function(ev) {
    ev.preventDefault();
    const item = {
        itemDescription: document.getElementById('itemDescription').value,
        stockPage: document.getElementById('stockPage').value,
        purchaseDate: document.getElementById('purchaseDate').value,
        invoiceNumber: document.getElementById('invoiceNumber').value,
        receiptNumber: document.getElementById('receiptNumber').value,
        supplierName: document.getElementById('supplierName').value,
        quantityReceived: parseInt(document.getElementById('quantityReceived').value) || 0,
        quantityIssued: parseInt(document.getElementById('quantityIssued').value) || 0,
    };
    item.remainingQuantity = item.quantityReceived - item.quantityIssued;

    const tx = db.transaction('inventory', 'readwrite');
    tx.objectStore('inventory').add(item).onsuccess = function() {
        syncToFirebase();
    };
});

function syncToFirebase() {
    const tx = db.transaction('inventory', 'readonly');
    tx.objectStore('inventory').getAll().onsuccess = function(e) {
        firebaseRootRef.set(e.target.result);
    };
}

function printInventory() {
    window.print();
}
function exportBackup() {}
function importBackup() {}
