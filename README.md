# Pandemic Simulator: A DeSci Platform for FHE-based Real-time Pandemic Spread Simulation

Imagine a world where health organizations can collaboratively simulate pandemic scenarios while ensuring the confidentiality of local data. Our project leverages **Zama's Fully Homomorphic Encryption technology** to transform this vision into reality, offering a **global cooperative platform** for health institutions to submit FHE-encrypted pandemic data and conduct large-scale, privacy-preserving virus spread simulations and predictions.

## Understanding the Challenge

In the face of pandemics, rapid and accurate data analysis is crucial. However, many health organizations face the challenge of sharing sensitive data without compromising individual privacy or national sovereignty. Without a secure method to collaborate and utilize local data, the potential for timely and effective public health responses diminishes significantly. 

## How FHE Addresses the Challenge

**Fully Homomorphic Encryption (FHE)** is the key to unlocking the potential for secure data collaboration in public health. By employing FHE, we can process encrypted data without needing to decrypt it, allowing health organizations to work together while keeping sensitive information private. This innovative approach is implemented using **Zama's open-source libraries**, such as **Concrete** and the **zama-fhe SDK**, which provide the tools necessary for performing complex computations on encrypted data.

## Core Functionalities

- **FHE Encryption for Pandemic Data**: Local pandemic data is encrypted using FHE to ensure privacy during simulations.
- **Homomorphic Simulations**: Our platform can run virus spread models on encrypted data, providing insights without compromising confidentiality.
- **Data Sovereignty**: The architecture supports global public health by respecting the data sovereignty of contributing nations.
- **Predictive Analytics**: Users can simulate different scenarios to predict the spread of viruses and assess potential interventions.
- **Global Pandemic Mapping**: Visualize pandemic data and simulation results on a global scale through our interactive maps.

## Technology Stack

- **Zama FHE SDK**: Powering confidential computing
- **Node.js**: For backend server operations
- **Hardhat**: For smart contract development and deployment
- **Database**: For storing user data and simulation results
- **Geographical Information System (GIS)**: For mapping pandemic simulations

## Project Directory Structure

Below is the structure of the pandemic simulator project:

```
Pandemic_Sim_Fhe/
├── contracts/
│   └── Pandemic_Simulator.sol
├── src/
│   ├── main.js
│   ├── simulation.js
│   └── utils.js
├── scripts/
│   └── deploy.js
├── tests/
│   ├── simulation.test.js
│   └── utils.test.js
├── package.json
└── README.md
```

## Setting Up the Project

To get started, ensure you have the following dependencies installed:

- **Node.js**: Make sure you have Node.js (version 14.x or later) installed on your system.
- **Hardhat**: If you haven’t already, install Hardhat globally by running `npm install --global hardhat`.

Once you have the prerequisites, navigate to the project directory and run the following command to install the required dependencies, including the Zama FHE libraries:

```bash
npm install
```

*Note: Do not use `git clone` or any URLs to download this project.*

## Compiling and Running the Simulator

To compile the smart contracts, use the following command:

```bash
npx hardhat compile
```

To run the tests and ensure everything functions correctly, execute:

```bash
npx hardhat test
```

To deploy the simulator on a test network, run:

```bash
npx hardhat run scripts/deploy.js --network <network_name>
```

Replace `<network_name>` with your desired network configuration.

## Engaging with the Simulator

Once the project is running, you can interact with the simulation through the provided JavaScript interface. Here's a simple example of how to initiate a simulation:

```javascript
const { initiateSimulation } = require('./simulation');

const pandemicData = {
    country: 'CountryX',
    cases: 1000,
    recoveryRate: 0.9,
    mutationImpact: 1.2,
};

initiateSimulation(pandemicData)
    .then((result) => {
        console.log('Simulation Result:', result);
    })
    .catch((error) => {
        console.error('Simulation Error:', error);
    });
```

This snippet shows how to call the `initiateSimulation` function, passing in encrypted pandemic data to receive simulation results without compromising confidentiality.

## Acknowledgements

### Powered by Zama

We extend our gratitude to the Zama team for their groundbreaking work and the open-source tools that empower developers like us to build secure and confidential blockchain applications. Their technology is instrumental in making this vital public health initiative possible.

---
By utilizing Zama's advanced encryption techniques, we aim to revolutionize how public health data is shared and processed, ultimately contributing to more informed and timely responses to pandemics. Join us on this journey toward a healthier, safer world! 🌍💉
