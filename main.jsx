import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc, runTransaction, getDocs } from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// Global variables for Firebase configuration, provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// CSS styles and utilities for the application. All in one file to respect the single file mandate.
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  body {
    font-family: 'Inter', sans-serif;
  }
  .modal-overlay {
    background-color: rgba(0, 0, 0, 0.5);
  }
  .modal-content {
    animation: fadeIn 0.3s ease-in-out;
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  .item-card {
    transition: transform 0.2s ease-in-out;
  }
  .item-card:hover {
    transform: translateY(-5px);
  }
  input, select, textarea {
    border: 1px solid #d1d5db;
  }
  .lds-dual-ring {
    display: inline-block;
    width: 80px;
    height: 80px;
  }
  .lds-dual-ring:after {
    content: " ";
    display: block;
    width: 64px;
    height: 64px;
    margin: 8px;
    border-radius: 50%;
    border: 6px solid #fff;
    border-color: #fff transparent #fff transparent;
    animation: lds-dual-ring 1.2s linear infinite;
  }
  @keyframes lds-dual-ring {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

// Helper component for modals to reduce code duplication
const Modal = ({ show, onClose, title, children }) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay">
      <div className="modal-content bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-auto">
        {title && <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">{title}</h2>}
        {children}
      </div>
    </div>
  );
};

// Main App component
const App = () => {
  // State variables for the application
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [items, setItems] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentEditingItem, setCurrentEditingItem] = useState(null);
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributorName, setContributorName] = useState('');
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  // Form input states for Add/Edit Modal
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemCost, setItemCost] = useState('');
  const [contributionType, setContributionType] = useState('item');
  const [itemDate, setItemDate] = useState('');
  const [partialContributionAllowed, setPartialContributionAllowed] = useState(false);


  // Firebase service instances
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [wishlistCollection, setWishlistCollection] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const isAdmin = user?.uid === 'your-admin-uid';

  // Sample items to pre-populate the wishlist
  const sampleItems = [
    {
      itemName: 'Alter Table',
      category: 'Furniture',
      expectedCost: 1500.00,
      contributionType: 'item',
      dateNeeded: '2025-12-25',
      status: 'Pending',
      isPartialAllowed: false,
      currentContributions: 0,
      createdAt: new Date(),
    },
    {
      itemName: 'Bema Table',
      category: 'Furniture',
      expectedCost: 800.00,
      contributionType: 'cash',
      dateNeeded: '2026-01-15',
      status: 'Pending',
      isPartialAllowed: true,
      currentContributions: 250.00,
      createdAt: new Date(),
    },
    {
      itemName: 'New Flag Pole',
      category: 'Exterior',
      expectedCost: 5000.00,
      contributionType: 'cash',
      dateNeeded: '2025-11-01',
      status: 'Pending',
      isPartialAllowed: true,
      currentContributions: 0,
      createdAt: new Date(),
    },
  ];

  // Effect for initializing Firebase and handling authentication state
  useEffect(() => {
    // Set Firestore log level to debug
    setLogLevel('debug');

    // Initialize Firebase app and services
    const firebaseApp = initializeApp(firebaseConfig);
    const firebaseAuth = getAuth(firebaseApp);
    const firestoreDb = getFirestore(firebaseApp);
    const firestoreCollection = collection(firestoreDb, `/artifacts/${appId}/public/data/wishlistItems`);
    
    setAuth(firebaseAuth);
    setDb(firestoreDb);
    setWishlistCollection(firestoreCollection);

    // Set up the authentication state listener
    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else if (initialAuthToken) {
        try {
          await signInWithCustomToken(firebaseAuth, initialAuthToken);
        } catch (error) {
          console.error("Error signing in with custom token, falling back:", error);
          await signInAnonymously(firebaseAuth);
        }
      } else {
        await signInAnonymously(firebaseAuth);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribeAuth();
  }, []);

  // Effect for fetching and listening to Firestore data and populating with sample data if empty
  useEffect(() => {
    const checkAndAddSamples = async () => {
      if (db && isAuthReady && !isDataLoaded) {
        const querySnapshot = await getDocs(wishlistCollection);
        if (querySnapshot.empty) {
          const batch = runTransaction(db, async (transaction) => {
            sampleItems.forEach(item => {
              const newDocRef = doc(wishlistCollection);
              transaction.set(newDocRef, item);
            });
          });
          console.log("Sample items added to Firestore.");
        }
        setIsDataLoaded(true);
      }
    };

    if (db && isAuthReady) {
      checkAndAddSamples();
    }
  }, [db, isAuthReady, isDataLoaded]);

  // Effect for setting up Firestore listener for main wishlist items
  useEffect(() => {
    if (isAuthReady && db) {
      setLoading(true);
      const unsubscribe = onSnapshot(wishlistCollection, (snapshot) => {
        const fetchedItems = [];
        snapshot.forEach(doc => {
          fetchedItems.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort items by status: Pending, Signed Up, Completed
        fetchedItems.sort((a, b) => {
          const statusOrder = { 'Pending': 1, 'Signed Up': 2, 'Completed': 3 };
          return statusOrder[a.status] - statusOrder[b.status];
        });
        
        setItems(fetchedItems);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching documents:", error);
        setLoading(false);
        showAlert('Failed to load wishlist. Please try again.');
      });

      return () => unsubscribe();
    }
  }, [isAuthReady, db]);

  // Effect to listen for contributions on the currently selected item
  useEffect(() => {
    if (currentEditingItem && db) {
      const contributionsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'wishlistItems', currentEditingItem.id, 'contributions');
      const unsubscribe = onSnapshot(contributionsCollection, (snapshot) => {
        const fetchedContributions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setContributions(fetchedContributions);
      }, (error) => {
        console.error("Error fetching contributions:", error);
      });
      return () => unsubscribe();
    }
  }, [currentEditingItem, db]);

  // UI Functions
  const showAlert = (message) => {
    setAlertMessage(message);
    setShowAlertModal(true);
  };

  const handleAuth = async () => {
    if (user && user.isAnonymous) {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider).catch(e => console.error("Sign-in error:", e));
    } else if (user) {
      await signOut(auth);
    }
  };

  const resetForm = () => {
    setItemName('');
    setItemCategory('');
    setItemCost('');
    setContributionType('item');
    setItemDate('');
    setPartialContributionAllowed(false);
    setIsEditing(false);
    setCurrentEditingItem(null);
  };

  const handleSubmitItem = async (e) => {
    e.preventDefault();
    if (!user || !isAdmin) {
      showAlert('You do not have permission to add or edit an item.');
      return;
    }

    const itemData = {
      itemName,
      category: itemCategory,
      expectedCost: parseFloat(itemCost),
      contributionType,
      dateNeeded: itemDate,
      isPartialAllowed: contributionType === 'cash' && partialContributionAllowed,
    };

    if (isEditing) {
      // Logic for editing an existing item
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'wishlistItems', currentEditingItem.id), {
          ...itemData,
          updatedAt: new Date(),
        });
        setShowAddItemModal(false);
        resetForm();
        showAlert('Item updated successfully!');
      } catch (error) {
        console.error("Error updating document:", error);
        showAlert('Failed to update item. Please try again.');
      }
    } else {
      // Logic for adding a new item
      try {
        await addDoc(wishlistCollection, {
          ...itemData,
          status: 'Pending',
          currentContributions: 0,
          createdAt: new Date(),
          createdBy: user.uid,
          creatorName: user.displayName || 'Anonymous',
        });
        setShowAddItemModal(false);
        resetForm();
        showAlert('Item added successfully!');
      } catch (error) {
        console.error("Error adding document:", error);
        showAlert('Failed to add item. Please try again.');
      }
    }
  };

  const handleContribute = async (e) => {
    e.preventDefault();
    if (!currentEditingItem) return;

    // Use a provided name if user is anonymous, otherwise use their displayName
    const nameToUse = user.displayName || contributorName || 'Anonymous';
    if (!nameToUse) {
      showAlert('Please enter your name to contribute.');
      return;
    }
    
    const itemRef = doc(db, 'artifacts', appId, 'public', 'data', 'wishlistItems', currentEditingItem.id);

    if (currentEditingItem.contributionType === 'item') {
      try {
        await updateDoc(itemRef, {
          status: 'Signed Up',
          contributorId: user.uid,
          contributorName: nameToUse
        });
        showAlert('You have successfully signed up for this item!');
        setShowDetailsModal(false);
      } catch (error) {
        console.error('Error signing up for item:', error);
        showAlert('An error occurred. Please try again.');
      }
    } else if (currentEditingItem.contributionType === 'cash' && currentEditingItem.isPartialAllowed) {
      const amount = parseFloat(contributionAmount);
      if (isNaN(amount) || amount <= 0) {
        showAlert('Please enter a valid contribution amount.');
        return;
      }
      try {
        await runTransaction(db, async (transaction) => {
          const itemDoc = await transaction.get(itemRef);
          if (!itemDoc.exists()) {
            throw new Error("Document does not exist!");
          }
          const currentContributions = itemDoc.data().currentContributions || 0;
          const newContributions = currentContributions + amount;
          const newStatus = newContributions >= itemDoc.data().expectedCost ? 'Completed' : 'Signed Up';

          transaction.update(itemRef, {
            currentContributions: newContributions,
            status: newStatus,
          });

          // Also add a contribution record to a subcollection for tracking
          const contributionsCollection = collection(itemRef, 'contributions');
          const contributionsDocRef = doc(contributionsCollection);
          transaction.set(contributionsDocRef, {
            userId: user.uid,
            amount,
            timestamp: Date.now(),
            contributorName: nameToUse
          });
        });
        showAlert('Thank you for your contribution!');
        setShowDetailsModal(false);
      } catch (e) {
        console.error("Transaction failed: ", e);
        showAlert('An error occurred during your contribution. Please try again.');
      }
    }
  };

  const handleDeleteItem = async () => {
    if (!currentEditingItem || !isAdmin) {
      showAlert('You do not have permission to delete this item.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'wishlistItems', currentEditingItem.id));
      showAlert('Item successfully deleted!');
      setShowDetailsModal(false);
    } catch (error) {
      console.error("Error deleting document: ", error);
      showAlert('An error occurred while deleting the item.');
    }
  };

  const handleEditClick = (item) => {
    setCurrentEditingItem(item);
    setItemName(item.itemName);
    setItemCategory(item.category);
    setItemCost(item.expectedCost);
    setContributionType(item.contributionType);
    setItemDate(item.dateNeeded);
    setPartialContributionAllowed(item.isPartialAllowed);
    setIsEditing(true);
    setShowAddItemModal(true);
    setShowDetailsModal(false);
  };

  const handleOpenAddItemModal = () => {
    resetForm();
    setShowAddItemModal(true);
  };

  const handleCloseAddItemModal = () => {
    setShowAddItemModal(false);
    resetForm();
  };

  // Render logic
  const renderItemCard = (item) => {
    let statusColor = 'bg-gray-400';
    let statusText = 'Pending';
    if (item.status === 'Signed Up') {
      statusColor = 'bg-amber-400';
      statusText = 'Signed Up';
    } else if (item.status === 'Completed') {
      statusColor = 'bg-amber-400';
      statusText = 'Completed';
    }
    const progressHtml = item.contributionType === 'cash' && item.isPartialAllowed ? (
      <>
        <div className="w-full bg-gray-200 rounded-full h-2.5 my-2">
          <div className="bg-amber-400 h-2.5 rounded-full" style={{ width: `${Math.round(((item.currentContributions || 0) / item.expectedCost) * 100)}%` }}></div>
        </div>
        <p className="text-xs text-gray-500 font-medium">${(item.currentContributions || 0).toFixed(2)} of ${item.expectedCost.toFixed(2)} raised</p>
      </>
    ) : null;

    return (
      <div
        key={item.id}
        className="item-card bg-white rounded-xl shadow-lg p-6 flex flex-col justify-between cursor-pointer"
        onClick={() => {
          setCurrentEditingItem(item);
          setContributionAmount('');
          setContributorName('');
          setShowDetailsModal(true);
        }}
      >
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-semibold text-gray-800">{item.itemName}</h3>
            <span className={`px-2 py-1 text-xs font-bold rounded-full text-white ${statusColor}`}>{statusText}</span>
          </div>
          <p className="text-sm text-gray-500 mb-2">{item.category}</p>
          <p className="text-lg font-bold text-gray-700">Cost: ${item.expectedCost.toFixed(2)}</p>
          {progressHtml}
        </div>
        <div className="mt-4 text-xs text-gray-400 text-right">
          Needed by: {new Date(item.dateNeeded).toLocaleDateString()}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{styles}</style>
      <div className="bg-blue-950 text-white min-h-screen flex flex-col items-center">
        {/* Main Container */}
        <div id="app" className="w-full max-w-4xl mx-auto px-4 py-8">
          {/* Header */}
          <header className="text-center mb-10">
            <h1 className="text-4xl font-bold text-white mb-2 flex justify-center items-center space-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8 text-amber-300">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>STSM Church Denver - Wishlist</span>
            </h1>
            <p className="text-lg text-blue-300">Help STSM Church Denver meet its goals by contributing to the items on our wishlist.</p>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-4">
              {user && (
                <div className="flex items-center space-x-2 p-2 bg-blue-900 rounded-full shadow">
                  <img className="w-8 h-8 rounded-full" src={user.photoURL || 'https://placehold.co/100x100'} alt="User Photo" />
                  <span className="text-sm font-medium text-white">{user.displayName || 'Anonymous'}</span>
                </div>
              )}
              {user && user.isAnonymous ? (
                <button onClick={handleAuth} className="px-6 py-3 bg-amber-400 text-blue-900 rounded-full font-semibold shadow-md hover:bg-amber-500 transition duration-300">
                  Sign in with Google
                </button>
              ) : (
                user && (
                  <button onClick={handleAuth} className="px-6 py-3 bg-amber-400 text-blue-900 rounded-full font-semibold shadow-md hover:bg-amber-500 transition duration-300">
                    Sign Out
                  </button>
                )
              )}
            </div>
            {user && (
              <div className="mt-2 text-xs text-gray-500">
                Your User ID: <span id="user-id-text">{user.uid}</span>
              </div>
            )}
          </header>

          {/* Loading Indicator */}
          {loading && (
            <div className="flex justify-center items-center mt-20">
              <div className="lds-dual-ring"></div>
              <p className="ml-4 text-xl text-white">Loading...</p>
            </div>
          )}

          {/* Wishlist Items Container */}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map(item => renderItemCard(item))}
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="text-center text-blue-300 text-lg col-span-full">No items on the wishlist yet. Add one!</p>
          )}

          {/* Add Item Button */}
          {user && isAdmin && (
            <div className="fixed bottom-6 right-6 z-50">
              <button onClick={handleOpenAddItemModal} className="w-14 h-14 bg-amber-400 text-blue-900 rounded-full text-3xl font-bold shadow-lg hover:bg-amber-500 transition duration-300 transform hover:scale-110 flex items-center justify-center">
                +
              </button>
            </div>
          )}
        </div>

        {/* Modal for adding/editing new items */}
        <Modal show={showAddItemModal}>
          <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">{isEditing ? 'Edit Wishlist Item' : 'Add New Wishlist Item'}</h2>
          <form className="space-y-4" onSubmit={handleSubmitItem}>
            <div>
              <label htmlFor="item-name" className="block text-sm font-medium text-gray-700">Item Name</label>
              <input type="text" id="item-name" value={itemName} onChange={(e) => setItemName(e.target.value)} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="item-category" className="block text-sm font-medium text-gray-700">Category</label>
              <input type="text" id="item-category" value={itemCategory} onChange={(e) => setItemCategory(e.target.value)} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="item-cost" className="block text-sm font-medium text-gray-700">Expected Cost ($)</label>
              <input type="number" id="item-cost" value={itemCost} onChange={(e) => setItemCost(e.target.value)} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="contribution-type" className="block text-sm font-medium text-gray-700">Contribution Type</label>
              <select id="contribution-type" value={contributionType} onChange={(e) => {
                setContributionType(e.target.value);
                setPartialContributionAllowed(e.target.value === 'cash' ? partialContributionAllowed : false);
              }} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="item">Buy Item</option>
                <option value="cash">Cash Contribution</option>
              </select>
            </div>
            {contributionType === 'cash' && (
              <div id="partial-contribution-field">
                <label className="flex items-center text-sm font-medium text-gray-700 cursor-pointer">
                  <input type="checkbox" id="partial-contribution-checkbox" checked={partialContributionAllowed} onChange={(e) => setPartialContributionAllowed(e.target.checked)} className="rounded text-blue-600" />
                  <span className="ml-2">Allow partial contributions?</span>
                </label>
              </div>
            )}
            <div>
              <label htmlFor="item-date" className="block text-sm font-medium text-gray-700">Date Needed</label>
              <input type="date" id="item-date" value={itemDate} onChange={(e) => setItemDate(e.target.value)} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div className="flex justify-end space-x-4 mt-6">
              <button type="button" onClick={handleCloseAddItemModal} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">{isEditing ? 'Save Changes' : 'Add Item'}</button>
            </div>
          </form>
        </Modal>

        {/* Modal for viewing item details and contributing */}
        <Modal show={showDetailsModal}>
          {currentEditingItem && (
            <>
              <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">{currentEditingItem.itemName}</h2>
              <p className="text-sm text-gray-500 text-center mb-4">{currentEditingItem.category}</p>
              <div className="space-y-4">
                <p className="text-lg font-medium text-center text-gray-700">Expected Cost: ${currentEditingItem.expectedCost.toFixed(2)}</p>
                {currentEditingItem.contributionType === 'cash' && currentEditingItem.isPartialAllowed && (
                  <div className="modal-contribution-progress-container">
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div className="bg-amber-400 h-2.5 rounded-full" style={{ width: `${Math.round(((currentEditingItem.currentContributions || 0) / currentEditingItem.expectedCost) * 100)}%` }}></div>
                    </div>
                    <p className="text-center text-sm text-gray-500 mt-1">${(currentEditingItem.currentContributions || 0).toFixed(2)} of ${currentEditingItem.expectedCost.toFixed(2)} raised</p>
                  </div>
                )}
                <p className="text-sm text-gray-500 text-center">Needed by: {new Date(currentEditingItem.dateNeeded).toLocaleDateString()}</p>
                <p className={`text-center font-bold text-lg ${currentEditingItem.status === 'Completed' ? 'text-green-600' : currentEditingItem.status === 'Signed Up' ? 'text-yellow-600' : 'text-gray-600'}`}>
                  {currentEditingItem.status}
                </p>
              </div>

              {/* Contribution summary dashboard */}
              <div className="mt-6 border-t pt-4">
                <h3 className="text-xl font-semibold mb-2">Contributors</h3>
                {contributions.length > 0 ? (
                  <ul className="list-disc list-inside text-gray-700">
                    {contributions.map(c => (
                      <li key={c.id} className="text-sm">
                        <span className="font-medium">{c.contributorName}</span>
                        {c.amount ? ` contributed $${c.amount.toFixed(2)}` : ' signed up to buy this item'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No contributions yet.</p>
                )}
              </div>

              <form onSubmit={handleContribute} className="mt-6 space-y-4">
                {currentEditingItem.status === 'Pending' && (
                  <>
                    {!user.displayName && (
                      <div>
                        <label htmlFor="contributor-name" className="block text-sm font-medium text-gray-700">Your Name</label>
                        <input type="text" id="contributor-name" value={contributorName} onChange={(e) => setContributorName(e.target.value)} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500" />
                      </div>
                    )}
                    {currentEditingItem.contributionType === 'cash' && currentEditingItem.isPartialAllowed && (
                      <div>
                        <label htmlFor="contribution-amount" className="block text-sm font-medium text-gray-700">Your Contribution ($)</label>
                        <input type="number" id="contribution-amount" value={contributionAmount} onChange={(e) => setContributionAmount(e.target.value)} required className="mt-1 block w-full rounded-md p-2 focus:ring-blue-500 focus:border-blue-500" />
                      </div>
                    )}
                    <div className="flex justify-center space-x-4 mt-6">
                      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
                        {currentEditingItem.contributionType === 'cash' ? 'Contribute' : 'Sign Up to Buy'}
                      </button>
                    </div>
                  </>
                )}
                <div className="flex justify-center space-x-4 mt-6">
                  <button type="button" onClick={() => setShowDetailsModal(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition">Close</button>
                  {isAdmin && (
                    <>
                      <button type="button" onClick={() => handleEditClick(currentEditingItem)} className="px-4 py-2 bg-yellow-600 text-white rounded-lg font-semibold hover:bg-yellow-700 transition">Edit</button>
                      <button type="button" onClick={handleDeleteItem} className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition">Delete Item</button>
                    </>
                  )}
                </div>
              </form>
            </>
          )}
        </Modal>

        {/* Alert Modal for messages */}
        <Modal show={showAlertModal}>
          <p className="text-lg text-gray-800 mb-4 text-center">{alertMessage}</p>
          <div className="flex justify-center">
            <button onClick={() => setShowAlertModal(false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">OK</button>
          </div>
        </Modal>
      </div>
    </>
  );
};

export default App;
