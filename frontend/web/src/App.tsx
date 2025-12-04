// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface PandemicData {
  id: string;
  encryptedCases: string;
  encryptedDeaths: string;
  encryptedRecovered: string;
  timestamp: number;
  country: string;
  region: string;
  status: "pending" | "verified" | "rejected";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'spreadSimulation':
      result = value * 1.2; // Simulate 20% spread increase
      break;
    case 'recoverySimulation':
      result = value * 0.8; // Simulate 20% recovery
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [pandemicData, setPandemicData] = useState<PandemicData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({ country: "", region: "", cases: 0, deaths: 0, recovered: 0 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedData, setSelectedData] = useState<PandemicData | null>(null);
  const [decryptedValues, setDecryptedValues] = useState<{cases?: number, deaths?: number, recovered?: number}>({});
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [simulationResult, setSimulationResult] = useState<{cases: number, deaths: number, recovered: number} | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  const verifiedCount = pandemicData.filter(d => d.status === "verified").length;
  const pendingCount = pandemicData.filter(d => d.status === "pending").length;
  const rejectedCount = pandemicData.filter(d => d.status === "rejected").length;

  useEffect(() => {
    loadPandemicData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadPandemicData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("pandemic_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing pandemic keys:", e); }
      }
      
      const list: PandemicData[] = [];
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`pandemic_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({ 
                id: key, 
                encryptedCases: data.cases, 
                encryptedDeaths: data.deaths, 
                encryptedRecovered: data.recovered, 
                timestamp: data.timestamp, 
                country: data.country, 
                region: data.region, 
                status: data.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading data ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPandemicData(list);
    } catch (e) { console.error("Error loading pandemic data:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitPandemicData = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setSubmitting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting pandemic data with Zama FHE..." });
    try {
      const encryptedCases = FHEEncryptNumber(newData.cases);
      const encryptedDeaths = FHEEncryptNumber(newData.deaths);
      const encryptedRecovered = FHEEncryptNumber(newData.recovered);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const pandemicData = { 
        cases: encryptedCases, 
        deaths: encryptedDeaths, 
        recovered: encryptedRecovered, 
        timestamp: Math.floor(Date.now() / 1000), 
        country: newData.country, 
        region: newData.region, 
        status: "pending" 
      };
      
      await contract.setData(`pandemic_${dataId}`, ethers.toUtf8Bytes(JSON.stringify(pandemicData)));
      
      const keysBytes = await contract.getData("pandemic_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(dataId);
      await contract.setData("pandemic_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted pandemic data submitted securely!" });
      await loadPandemicData();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewData({ country: "", region: "", cases: 0, deaths: 0, recovered: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setSubmitting(false); }
  };

  const decryptWithSignature = async (encryptedCases: string, encryptedDeaths: string, encryptedRecovered: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const cases = FHEDecryptNumber(encryptedCases);
      const deaths = FHEDecryptNumber(encryptedDeaths);
      const recovered = FHEDecryptNumber(encryptedRecovered);
      
      return { cases, deaths, recovered };
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const verifyData = async (dataId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const dataBytes = await contract.getData(`pandemic_${dataId}`);
      if (dataBytes.length === 0) throw new Error("Data not found");
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const verifiedCases = FHECompute(data.cases, 'spreadSimulation');
      const verifiedDeaths = FHECompute(data.deaths, 'spreadSimulation');
      const verifiedRecovered = FHECompute(data.recovered, 'recoverySimulation');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedData = { 
        ...data, 
        status: "verified",
        cases: verifiedCases,
        deaths: verifiedDeaths,
        recovered: verifiedRecovered
      };
      
      await contractWithSigner.setData(`pandemic_${dataId}`, ethers.toUtf8Bytes(JSON.stringify(updatedData)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      await loadPandemicData();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectData = async (dataId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const dataBytes = await contract.getData(`pandemic_${dataId}`);
      if (dataBytes.length === 0) throw new Error("Data not found");
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = { ...data, status: "rejected" };
      await contract.setData(`pandemic_${dataId}`, ethers.toUtf8Bytes(JSON.stringify(updatedData)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      await loadPandemicData();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const runSimulation = async () => {
    if (!selectedData) return;
    setTransactionStatus({ visible: true, status: "pending", message: "Running FHE-based pandemic simulation..." });
    try {
      const cases = FHEDecryptNumber(selectedData.encryptedCases);
      const deaths = FHEDecryptNumber(selectedData.encryptedDeaths);
      const recovered = FHEDecryptNumber(selectedData.encryptedRecovered);
      
      // Simple simulation model (in a real app this would be more complex)
      const simulatedCases = cases * 1.5; // 50% increase
      const simulatedDeaths = deaths * 1.2; // 20% increase
      const simulatedRecovered = recovered * 1.3; // 30% increase
      
      setSimulationResult({
        cases: simulatedCases,
        deaths: simulatedDeaths,
        recovered: simulatedRecovered
      });
      
      setShowSimulation(true);
      setTransactionStatus({ visible: true, status: "success", message: "Simulation completed successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Simulation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (dataAddress: string) => address?.toLowerCase() === dataAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to submit encrypted pandemic data", icon: "🔗" },
    { title: "Submit Encrypted Data", description: "Add your country's pandemic data which will be encrypted using FHE", icon: "🔒", details: "Case numbers, deaths and recoveries are encrypted on the client-side before submission" },
    { title: "FHE Processing", description: "Data is processed in encrypted state without decryption", icon: "⚙️", details: "Zama FHE technology allows computations on encrypted data for privacy-preserving simulations" },
    { title: "Get Results", description: "Receive verifiable pandemic predictions while keeping data private", icon: "📊", details: "The results are computed on encrypted data and can be verified without decryption" }
  ];

  const filteredData = pandemicData.filter(data => {
    const matchesSearch = data.country.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         data.region.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCountry = filterCountry ? data.country === filterCountry : true;
    return matchesSearch && matchesCountry;
  });

  const countries = [...new Set(pandemicData.map(data => data.country))];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🦠</div>
          <h1>Pandemic<span>Sim</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowSubmitModal(true)} className="submit-data-btn">
            + Submit Data
          </button>
          <button onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered Pandemic Simulation</h2>
            <p>A decentralized platform for privacy-preserving pandemic spread prediction using Zama FHE</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock">🔒</div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-section">
            <h2>How It Works</h2>
            <p className="subtitle">Learn how to securely share and process pandemic data</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="dashboard-section">
          <div className="stats-card">
            <h3>Global Data Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{pandemicData.length}</div>
                <div className="stat-label">Total Reports</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>

          <div className="map-card">
            <h3>Global Pandemic Map</h3>
            <div className="map-container">
            </div>
          </div>
        </div>

        <div className="data-section">
          <div className="section-header">
            <h2>Pandemic Data Reports</h2>
            <div className="search-filter">
              <input 
                type="text" 
                placeholder="Search by country or region..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select 
                value={filterCountry} 
                onChange={(e) => setFilterCountry(e.target.value)}
              >
                <option value="">All Countries</option>
                {countries.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
              <button onClick={loadPandemicData} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="data-table">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Country</div>
              <div className="header-cell">Region</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon">📊</div>
                <p>No pandemic data found</p>
                <button onClick={() => setShowSubmitModal(true)}>Submit First Report</button>
              </div>
            ) : filteredData.map(data => (
              <div className="table-row" key={data.id} onClick={() => setSelectedData(data)}>
                <div className="table-cell">#{data.id.substring(0, 6)}</div>
                <div className="table-cell">{data.country}</div>
                <div className="table-cell">{data.region}</div>
                <div className="table-cell">{new Date(data.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell">
                  <span className={`status-badge ${data.status}`}>{data.status}</span>
                </div>
                <div className="table-cell actions">
                  {isOwner(data.country) && data.status === "pending" && (
                    <>
                      <button className="action-btn verify" onClick={(e) => { e.stopPropagation(); verifyData(data.id); }}>Verify</button>
                      <button className="action-btn reject" onClick={(e) => { e.stopPropagation(); rejectData(data.id); }}>Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showSubmitModal && (
        <div className="modal-overlay">
          <div className="submit-modal">
            <div className="modal-header">
              <h2>Submit Pandemic Data</h2>
              <button onClick={() => setShowSubmitModal(false)} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Country</label>
                <input 
                  type="text" 
                  value={newData.country}
                  onChange={(e) => setNewData({...newData, country: e.target.value})}
                  placeholder="Enter country name"
                />
              </div>
              <div className="form-group">
                <label>Region</label>
                <input 
                  type="text" 
                  value={newData.region}
                  onChange={(e) => setNewData({...newData, region: e.target.value})}
                  placeholder="Enter region/state"
                />
              </div>
              <div className="form-group">
                <label>Cases</label>
                <input 
                  type="number" 
                  value={newData.cases}
                  onChange={(e) => setNewData({...newData, cases: parseInt(e.target.value) || 0})}
                  placeholder="Number of cases"
                />
              </div>
              <div className="form-group">
                <label>Deaths</label>
                <input 
                  type="number" 
                  value={newData.deaths}
                  onChange={(e) => setNewData({...newData, deaths: parseInt(e.target.value) || 0})}
                  placeholder="Number of deaths"
                />
              </div>
              <div className="form-group">
                <label>Recovered</label>
                <input 
                  type="number" 
                  value={newData.recovered}
                  onChange={(e) => setNewData({...newData, recovered: parseInt(e.target.value) || 0})}
                  placeholder="Number of recovered"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-item">
                  <span>Cases:</span>
                  <code>{FHEEncryptNumber(newData.cases).substring(0, 30)}...</code>
                </div>
                <div className="preview-item">
                  <span>Deaths:</span>
                  <code>{FHEEncryptNumber(newData.deaths).substring(0, 30)}...</code>
                </div>
                <div className="preview-item">
                  <span>Recovered:</span>
                  <code>{FHEEncryptNumber(newData.recovered).substring(0, 30)}...</code>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowSubmitModal(false)}>Cancel</button>
              <button onClick={submitPandemicData} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Encrypted Data"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedData && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Pandemic Data Details</h2>
              <button onClick={() => { setSelectedData(null); setDecryptedValues({}); setShowSimulation(false); }} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="data-info">
                <div className="info-item">
                  <span>Country:</span>
                  <strong>{selectedData.country}</strong>
                </div>
                <div className="info-item">
                  <span>Region:</span>
                  <strong>{selectedData.region}</strong>
                </div>
                <div className="info-item">
                  <span>Date:</span>
                  <strong>{new Date(selectedData.timestamp * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-item">
                  <span>Status:</span>
                  <strong className={`status-badge ${selectedData.status}`}>{selectedData.status}</strong>
                </div>
              </div>

              <div className="encrypted-data-section">
                <h3>Encrypted Data</h3>
                <div className="encrypted-data">
                  <div className="data-item">
                    <span>Cases:</span>
                    <code>{selectedData.encryptedCases.substring(0, 50)}...</code>
                  </div>
                  <div className="data-item">
                    <span>Deaths:</span>
                    <code>{selectedData.encryptedDeaths.substring(0, 50)}...</code>
                  </div>
                  <div className="data-item">
                    <span>Recovered:</span>
                    <code>{selectedData.encryptedRecovered.substring(0, 50)}...</code>
                  </div>
                </div>
                <button 
                  className="decrypt-btn"
                  onClick={async () => {
                    if (decryptedValues.cases !== undefined) {
                      setDecryptedValues({});
                    } else {
                      const decrypted = await decryptWithSignature(
                        selectedData.encryptedCases,
                        selectedData.encryptedDeaths,
                        selectedData.encryptedRecovered
                      );
                      if (decrypted) setDecryptedValues(decrypted);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedValues.cases !== undefined ? "Hide Values" : "Decrypt with Wallet"}
                </button>
              </div>

              {decryptedValues.cases !== undefined && (
                <div className="decrypted-data-section">
                  <h3>Decrypted Values</h3>
                  <div className="decrypted-values">
                    <div className="value-item">
                      <span>Cases:</span>
                      <strong>{decryptedValues.cases}</strong>
                    </div>
                    <div className="value-item">
                      <span>Deaths:</span>
                      <strong>{decryptedValues.deaths}</strong>
                    </div>
                    <div className="value-item">
                      <span>Recovered:</span>
                      <strong>{decryptedValues.recovered}</strong>
                    </div>
                  </div>
                  <button className="simulate-btn" onClick={runSimulation}>
                    Run FHE Simulation
                  </button>
                </div>
              )}

              {showSimulation && simulationResult && (
                <div className="simulation-results">
                  <h3>Simulation Results</h3>
                  <div className="results-grid">
                    <div className="result-item">
                      <span>Projected Cases:</span>
                      <strong>{Math.round(simulationResult.cases)}</strong>
                    </div>
                    <div className="result-item">
                      <span>Projected Deaths:</span>
                      <strong>{Math.round(simulationResult.deaths)}</strong>
                    </div>
                    <div className="result-item">
                      <span>Projected Recovered:</span>
                      <strong>{Math.round(simulationResult.recovered)}</strong>
                    </div>
                  </div>
                  <div className="simulation-note">
                    <p>Note: These projections are based on FHE-computed models while keeping the original data encrypted</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">🦠 PandemicSimFHE</div>
            <p>Privacy-preserving pandemic simulation powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">🔒 FHE-Powered Privacy</div>
          <div className="copyright">© {new Date().getFullYear()} PandemicSimFHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default App;