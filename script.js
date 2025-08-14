// ================= Firebase Config =================
const firebaseConfig = {
  apiKey: "AIzaSyAPiJHMYJzQdRh0XrE42803BaT7jzGuZ9A",
  authDomain: "school-stock.firebaseapp.com",
  projectId: "school-stock",
  storageBucket: "school-stock.firebasestorage.app",
  messagingSenderId: "644388078816",
  appId: "1:644388078816:web:e3fbb702c9a094032d3c85",
  measurementId: "G-PN72JHLB5M"
};

let firestore = null;

// ================= Initialize Firebase =================
function initFirebase() {
  try {
    // initialize if not already
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    firestore = firebase.firestore();
    setFirebaseStatus("Firebase (Firestore) සබඳතාව සක්‍රීයයි — දත්ත Firestore වෙත සකසන ලැබේ");
    console.log("✅ Firebase connected", firebase.app().name);
  } catch (err) {
    console.error("❌ Firebase init error:", err);
    setFirebaseStatus("Firebase සවිකිරීමේ දෝෂයක්: " + err.message);
  }
}

// ================= Status text helper =================
function setFirebaseStatus(msg) {
  const el = document.getElementById("firebaseStatus");
  if (el) el.textContent = "Firebase සම්බන්ධතා තත්ත්වය: " + msg;
}

// ================= Form Handling =================
document.addEventListener("DOMContentLoaded", () => {
  initFirebase();

  document.getElementById("inventoryForm").addEventListener("submit", (e) => {
    e.preventDefault();

    const data = {
      itemDescription: document.getElementById("itemDescription").value,
      stockPage: document.getElementById("stockPage").value,
      purchaseDate: document.getElementById("purchaseDate").value,
      invoiceNumber: document.getElementById("invoiceNumber").value,
      receiptNumber: document.getElementById("receiptNumber").value,
      supplierName: document.getElementById("supplierName").value,
      quantityReceived: parseInt(document.getElementById("quantityReceived").value),
      quantityIssued: parseInt(document.getElementById("quantityIssued").value),
      createdAt: new Date()
    };

    // Save to Firestore
    firestore.collection("inventory").add(data)
      .then(() => {
        alert("✅ දත්ත Firestore වෙත යවා ඇත!");
        e.target.reset();
      })
      .catch(err => {
        console.error("Firestore add error:", err);
        alert("❌ Firestore දෝෂයක්: " + err.message);
      });
  });
});
