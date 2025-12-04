pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PandemicSimFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60;

    bool public paused;

    struct Batch {
        uint256 id;
        bool active;
        uint256 dataCount;
    }
    Batch public currentBatch;
    uint256 public totalBatches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Encrypted data storage
    // Store sum of encrypted cases for a region
    mapping(uint256 => euint32) public encryptedRegionalCases;
    // Store sum of encrypted recovered for a region
    mapping(uint256 => euint32) public encryptedRegionalRecovered;
    // Store count of data submissions for a region (encrypted)
    mapping(uint256 => euint32) public encryptedRegionalDataPoints;

    // Configuration parameters
    uint256 public simulationThreshold = 10; // Min data points to trigger simulation

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSet(uint256 oldCooldown, uint256 newCooldown);
    event SimulationThresholdSet(uint256 oldThreshold, uint256 newThreshold);
    event Paused(address account);
    event Unpaused(address account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId, uint256 dataCount);
    event DataSubmitted(address indexed provider, uint256 indexed regionId, uint256 indexed batchId);
    event SimulationRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event SimulationCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 globalCases, uint256 globalRecovered, uint256 totalDataPoints);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error InvalidParameter();
    error BatchNotActive();
    error ReplayAttempt();
    error StateMismatch();
    error ProofVerificationFailed();
    error InsufficientData();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        _openNewBatch();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldown(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldown, newCooldown);
    }

    function setSimulationThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert InvalidParameter();
        uint256 oldThreshold = simulationThreshold;
        simulationThreshold = newThreshold;
        emit SimulationThresholdSet(oldThreshold, newThreshold);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function closeCurrentBatch() external onlyOwner whenNotPaused {
        Batch storage batch = currentBatch;
        if (!batch.active) revert BatchNotActive();
        batch.active = false;
        emit BatchClosed(batch.id, batch.dataCount);
    }

    function openNewBatch() external onlyOwner whenNotPaused {
        _openNewBatch();
    }

    function _openNewBatch() private {
        if (currentBatch.active) {
            currentBatch.active = false;
            emit BatchClosed(currentBatch.id, currentBatch.dataCount);
        }
        totalBatches++;
        currentBatch = Batch({ id: totalBatches, active: true, dataCount: 0 });
        emit BatchOpened(currentBatch.id);
    }

    function submitData(
        uint256 regionId,
        euint32 encryptedCases,
        euint32 encryptedRecovered
    ) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;

        Batch storage batch = currentBatch;
        if (!batch.active) revert BatchNotActive();

        _initIfNeeded(encryptedCases);
        _initIfNeeded(encryptedRecovered);

        if (!FHE.isInitialized(encryptedRegionalCases[regionId])) {
            encryptedRegionalCases[regionId] = FHE.asEuint32(0);
        }
        if (!FHE.isInitialized(encryptedRegionalRecovered[regionId])) {
            encryptedRegionalRecovered[regionId] = FHE.asEuint32(0);
        }
        if (!FHE.isInitialized(encryptedRegionalDataPoints[regionId])) {
            encryptedRegionalDataPoints[regionId] = FHE.asEuint32(0);
        }

        encryptedRegionalCases[regionId] = encryptedRegionalCases[regionId].add(encryptedCases);
        encryptedRegionalRecovered[regionId] = encryptedRegionalRecovered[regionId].add(encryptedRecovered);
        encryptedRegionalDataPoints[regionId] = encryptedRegionalDataPoints[regionId].add(FHE.asEuint32(1));

        batch.dataCount++;
        emit DataSubmitted(msg.sender, regionId, batch.id);
    }

    function runSimulation() external onlyOwner whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        Batch storage batch = currentBatch;
        if (!batch.active) revert BatchNotActive();
        if (batch.dataCount < simulationThreshold) revert InsufficientData();

        euint32 memory globalCases = FHE.asEuint32(0);
        euint32 memory globalRecovered = FHE.asEuint32(0);
        euint32 memory totalDataPoints = FHE.asEuint32(0);

        // Sum up all regional data (still encrypted)
        // This loop assumes regionIds are somewhat dense or known.
        // For a production system, you'd need a more robust way to iterate known regions.
        for (uint256 regionId = 0; regionId < 100; regionId++) { // Example: check first 100 regions
            if (FHE.isInitialized(encryptedRegionalCases[regionId])) {
                globalCases = globalCases.add(encryptedRegionalCases[regionId]);
            }
            if (FHE.isInitialized(encryptedRegionalRecovered[regionId])) {
                globalRecovered = globalRecovered.add(encryptedRegionalRecovered[regionId]);
            }
            if (FHE.isInitialized(encryptedRegionalDataPoints[regionId])) {
                totalDataPoints = totalDataPoints.add(encryptedRegionalDataPoints[regionId]);
            }
        }

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = FHE.toBytes32(globalCases);
        cts[1] = FHE.toBytes32(globalRecovered);
        cts[2] = FHE.toBytes32(totalDataPoints);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: batch.id, stateHash: stateHash, processed: false });
        emit SimulationRequested(requestId, batch.id, stateHash);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        DecryptionContext storage ctx = decryptionContexts[requestId];
        if (ctx.processed) revert ReplayAttempt();

        // Rebuild ciphertexts from current contract state for verification
        Batch storage batch = currentBatch; // Not used in reconstruction but good for context
        euint32 memory currentGlobalCases = FHE.asEuint32(0);
        euint32 memory currentGlobalRecovered = FHE.asEuint32(0);
        euint32 memory currentTotalDataPoints = FHE.asEuint32(0);

        for (uint256 regionId = 0; regionId < 100; regionId++) {
            if (FHE.isInitialized(encryptedRegionalCases[regionId])) {
                currentGlobalCases = currentGlobalCases.add(encryptedRegionalCases[regionId]);
            }
            if (FHE.isInitialized(encryptedRegionalRecovered[regionId])) {
                currentGlobalRecovered = currentGlobalRecovered.add(encryptedRegionalRecovered[regionId]);
            }
            if (FHE.isInitialized(encryptedRegionalDataPoints[regionId])) {
                currentTotalDataPoints = currentTotalDataPoints.add(encryptedRegionalDataPoints[regionId]);
            }
        }
        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = FHE.toBytes32(currentGlobalCases);
        currentCts[1] = FHE.toBytes32(currentGlobalRecovered);
        currentCts[2] = FHE.toBytes32(currentTotalDataPoints);

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != ctx.stateHash) revert StateMismatch();

        try FHE.checkSignatures(requestId, cleartexts, proof) {
            // Decoding must match the order in `cts` during requestDecryption
            uint256 clearGlobalCases = abi.decode(cleartexts.slice(0, 32), (uint256));
            uint256 clearGlobalRecovered = abi.decode(cleartexts.slice(32, 32), (uint256));
            uint256 clearTotalDataPoints = abi.decode(cleartexts.slice(64, 32), (uint256));

            ctx.processed = true;
            emit SimulationCompleted(requestId, ctx.batchId, clearGlobalCases, clearGlobalRecovered, clearTotalDataPoints);
        } catch {
            revert ProofVerificationFailed();
        }
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal pure {
        if (!FHE.isInitialized(x)) revert("FHE variable not initialized.");
    }

    function _requireInitialized(euint32 x) internal pure {
        if (!FHE.isInitialized(x)) revert("FHE variable not initialized.");
    }
}