let db;
const request = indexedDB.open('schoolInventory', 4);

request.onupgradeneeded = function(event) {
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

request.onsuccess = function(event) {
    db = event.target.result;
    loadInventory();
};

let editingId = null;

// Add or Update Inventory
document.getElementById('inventoryForm').addEventListener('submit', function(event) {
    event.preventDefault();

    const itemDescription = document.getElementById('itemDescription').value;
    const stockPage = document.getElementById('stockPage').value;
    const purchaseDate = document.getElementById('purchaseDate').value;
    const invoiceNumber = document.getElementById('invoiceNumber').value;
    const receiptNumber = document.getElementById('receiptNumber').value;
    const supplierName = document.getElementById('supplierName').value;
    const quantityReceived = parseInt(document.getElementById('quantityReceived').value);
    const quantityIssued = parseInt(document.getElementById('quantityIssued').value);

    const transaction = db.transaction(['inventory', 'purchaseHistory'], 'readwrite');
    const store = transaction.objectStore('inventory');
    const purchaseHistoryStore = transaction.objectStore('purchaseHistory');

    if (editingId) {
        // Updating existing item
        const getRequest = store.get(editingId);
        getRequest.onsuccess = function(event) {
            const existingItem = event.target.result;
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

            updateRequest.onsuccess = function() {
                // Add purchase history
                const purchaseHistory = {
                    itemId: editingId,
                    purchaseDate: purchaseDate,
                    quantityReceived: quantityReceived,
                    supplierName: supplierName,
                    invoiceNumber: invoiceNumber
                };
                
                purchaseHistoryStore.add(purchaseHistory);
                
                loadInventory();
                document.getElementById('inventoryForm').reset();
                editingId = null;
            };
        };
    } else {
        // Adding new item
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

        addRequest.onerror = function(event) {
            if (event.target.error.name === 'ConstraintError') {
                alert('අයිතමය දැනටමත් පවතී. කරුණාකර වෙනත් විස්තරයක් භාවිතා කරන්න.');
            }
        };

        addRequest.onsuccess = function(event) {
            const itemId = event.target.result;
            
            // Add purchase history
            const purchaseHistory = {
                itemId: itemId,
                purchaseDate: purchaseDate,
                quantityReceived: quantityReceived,
                supplierName: supplierName,
                invoiceNumber: invoiceNumber
            };
            
            purchaseHistoryStore.add(purchaseHistory);
            
            loadInventory();
            document.getElementById('inventoryForm').reset();
        };
    }
});

// Load Inventory
function loadInventory() {
    const transaction = db.transaction(['inventory'], 'readonly');
    const store = transaction.objectStore('inventory');
    const request = store.getAll();

    request.onsuccess = function(event) {
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
    };
}

// Show Purchase History
function showPurchaseHistory(itemId) {
    const transaction = db.transaction(['purchaseHistory'], 'readonly');
    const store = transaction.objectStore('purchaseHistory');
    const index = store.index('itemId');
    const request = index.getAll(itemId);

    request.onsuccess = function(event) {
        const purchaseHistory = event.target.result;
        let historyHTML = '<h3>මිලදී ගැනීම් ඉතිහාසය</h3>';
        
        if (purchaseHistory.length > 0) {
            historyHTML += '<ul>';
            purchaseHistory.forEach(purchase => {
                historyHTML += `<li>
                    දිනය: ${purchase.purchaseDate}, 
                    ප්‍රමාණය: ${purchase.quantityReceived}, 
                    සැපයුම්කරු: ${purchase.supplierName}, 
                    ඉන්වොයිස් අංකය: ${purchase.invoiceNumber}
                </li>`;
            });
            historyHTML += '</ul>';
        } else {
            historyHTML += '<p>මිලදී ගැනීම් ඉතිහාසයක් නොමැත.</p>';
        }

        document.getElementById('purchaseHistory').innerHTML = historyHTML;
    };
}

// Distribute Item
function distributeItem(id) {
    const recipient = prompt("ලබන්නාගේ නම ඇතුළත් කරන්න:");
    const quantity = parseInt(prompt("බෙදාහරින ප්‍රමාණය ඇතුළත් කරන්න:"));
    const date = prompt("දිනය ඇතුළත් කරන්න (YYYY-MM-DD):");

    if (recipient && quantity && date) {
        const transaction = db.transaction(['inventory', 'distribution'], 'readwrite');
        const inventoryStore = transaction.objectStore('inventory');
        const distributionStore = transaction.objectStore('distribution');

        const inventoryRequest = inventoryStore.get(id);

        inventoryRequest.onsuccess = function(event) {
            const item = event.target.result;

            if (item.remainingQuantity >= quantity) {
                item.quantityIssued += quantity;
                item.remainingQuantity -= quantity;

                inventoryStore.put(item);

                const distribution = {
                    itemId: id,
                    recipient: recipient,
                    quantity: quantity,
                    date: date
                };

                distributionStore.add(distribution);

                loadInventory();
                alert("අයිතමය සාර්ථකව බෙදාහරින ලදී.");
            } else {
                alert("ප්‍රමාණවත් තොගයක් නොමැත.");
            }
        };
    }
}

// Edit an Inventory Item
function editItem(id) {
    const transaction = db.transaction(['inventory'], 'readonly');
    const store = transaction.objectStore('inventory');
    const request = store.get(id);

    request.onsuccess = function(event) {
        const item = event.target.result;
        document.getElementById('itemDescription').value = item.itemDescription;
        document.getElementById('stockPage').value = item.stockPage;
        document.getElementById('purchaseDate').value = item.purchaseDate;
        document.getElementById('invoiceNumber').value = item.invoiceNumber;
        document.getElementById('receiptNumber').value = item.receiptNumber;
        document.getElementById('supplierName').value = item.supplierName;
        document.getElementById('quantityReceived').value = 0;  // Set to 0 for new purchases
        document.getElementById('quantityIssued').value = item.quantityIssued;

        editingId = id;
    };
}

// Delete an Inventory Item
function deleteItem(id) {
    if (confirm('ඔබට මෙම අයිතමය ඉවත් කිරීමට අවශ්‍ය බව විශ්වාසද?')) {
        const transaction = db.transaction(['inventory'], 'readwrite');
        const store = transaction.objectStore('inventory');
        const request = store.delete(id);

        request.onsuccess = function() {
            loadInventory();
        };
    }
}

// Search Inventory
document.getElementById('search').addEventListener('input', function() {
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

// Fetch and display distribution history
function fetchAndDisplayDistributionHistory(itemId, row) {
    const transaction = db.transaction(['distribution'], 'readonly');
    const store = transaction.objectStore('distribution');
    const index = store.index('itemId');
    const request = index.getAll(parseInt(itemId));

    request.onsuccess = function(event) {
        const distributions = event.target.result;
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
        
        // Remove existing history if present
        row.querySelector('.distribution-history')?.remove();
        
        // Append new history
        const lastCell = row.querySelector('td:last-child');
        lastCell.insertAdjacentHTML('beforeend', historyHTML);
    };
}

// Print Inventory
function printInventory() {
    window.print();
}

// Backup Inventory Data
function exportBackup() {
    const transaction = db.transaction(['inventory'], 'readonly');
    const store = transaction.objectStore('inventory');
    const request = store.getAll();

    request.onsuccess = function(event) {
        const inventory = event.target.result;
        const jsonString = JSON.stringify(inventory);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = "inventory_backup.json";
        link.click();
    };
}

// Restore Inventory Data
function importBackup(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = JSON.parse(e.target.result);
        const transaction = db.transaction(['inventory'], 'readwrite');
        const store = transaction.objectStore('inventory');

        // Clear existing data
        store.clear();

        let addedCount = 0;
        data.forEach(item => {
            const request = store.add(item);
            request.onsuccess = function() {
                addedCount++;
                if (addedCount === data.length) {
                    loadInventory();
                    alert('දත්ත සාර්ථකව ප්‍රතිස්ථාපනය කරන ලදී.');
                }
            };
        });
    };
    reader.readAsText(file);
}

// Update all rows' distribution history
function updateAllDistributionHistory() {
    const rows = document.querySelectorAll('#inventoryTable tbody tr');
    rows.forEach(row => {
        const itemId = row.querySelector('button[onclick^="editItem"]').getAttribute('onclick').match(/\d+/)[0];
        fetchAndDisplayDistributionHistory(itemId, row);
    });
}