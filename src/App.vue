<template>
  <div class="container mx-auto">
    <status
      :isConnected="isConnected"
      :walletAddress="walletAddress"
      @disconnect="disconnect"
    />
    <main>
      <hero
        :isConnected="isConnected"
        :balances="balances"
        :claim="claim"
        :selectedTokenId="selectedTokenId"
        :selectedBundle="selectedBundle"
        :allowBundle="
          selectedBundle &&
          validateBundleRequirements(
            meta.find((m) => m.tokenId === selectedBundle).tokens
          )
        "
        :allowUnbundle="selectedBundle && balances[selectedBundle] > 0"
        :paused="paused"
        @connect="connect"
        @disconnect="disconnect"
        @claim="initClaim"
        @bundle="initBundle"
        @unbundle="initUnbundle"
      />

      <wallet
        :isConnected="isConnected"
        :balances="balances"
        :claim="claim"
        :selectedCards="selectedCards"
        :selectedBundle="selectedBundle"
        :selectedBundleRequirements="
          selectedBundle
            ? meta.find((m) => m.tokenId === selectedBundle).tokens
            : []
        "
        @selectCard="selectSingleCard"
        @cardZoom="cardZoom"
      />

      <bundle
        :isConnected="isConnected"
        :balances="balances"
        :claim="claim"
        :selectedBundle="selectedBundle"
        @selectBundle="selectBundle"
        @cardZoom="cardZoom"
      />
    </main>

    <aside class="modal" v-if="transaction.error.state">
      <img class="icon__sad" src="./assets/sad-mac.png" alt="sad mac" />
      <p><strong>There was an error.</strong></p>
      <p style="word-break: break-all">{{ transaction.error.message }}</p>
      <button
        class="top-space button__single button__black"
        @click="resetTransaction"
      >
        Close
      </button>
    </aside>
    <aside class="modal" v-else-if="transaction.processing">
      <img src="./assets/hourglass.gif" alt="loading" />
      <p>Processing transaction...</p>
    </aside>
    <aside class="modal" v-else-if="showBundleModal">
      <p>
        You are about to bundle tokens
        <strong>{{
          meta.find((m) => m.tokenId === selectedBundle).tokens.join(", ")
        }}</strong>
        into the
        <strong>{{
          meta.find((m) => m.tokenId === selectedBundle).name
        }}</strong>
        bundle. Do you wish to continue?
      </p>
      <div class="button__row">
        <button @click="cancel" class="cancel button__single button__black">
          Cancel
        </button>
        <button @click="confirmBundle" class="button__single button__white">
          Confirm
        </button>
      </div>
    </aside>
    <aside class="modal" v-else-if="showUnbundleModal">
      <p>
        You are about to unbundle
        <strong>{{
          meta.find((m) => m.tokenId === selectedBundle).name
        }}</strong>
        into tokens
        <strong>{{
          meta.find((m) => m.tokenId === selectedBundle).tokens.join(", ")
        }}</strong
        >. Do you wish to continue?
      </p>
      <div class="button__row">
        <button @click="cancel" class="cancel button__single button__black">
          Cancel
        </button>
        <button @click="confirmUnbundle" class="button__single button__white">
          Confirm
        </button>
      </div>
    </aside>

    <div class="zoomModalBackground" v-if="(zoomedCard !== null)"></div>

    <aside class="modal" v-if="(zoomedCard !== null)">
      <button
        class="close button__single button__white"
        @click="cardZoom(null)"
      >
        Close
      </button>
      <p style="position: fixed">Loading 3D model...</p>
      <model-viewer
        load="() => console.log('loaded')"
        id="model3d"
        :src="`./assets/3d/Curio_${zoomedCard}.glb`"
        camera-controls
      ></model-viewer>
    </aside>
  </div>
</template>

<style>
main {
  display: grid;
}

@media only screen and (min-width: 768px) {
  main {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

model-viewer::part(default-progress-bar) {
  border: 1px solid var(--white);
  margin-top: 8px;
}
</style>

<script>
const ethers = require("ethers");
const WalletConnectProvider = require("./lib/walletconnect.bundle").default;
const Web3Modal = require("web3modal").default;

const Claims = require("./data/claims.json");
const Meta = require("./data/meta.json");

let CURIO_ADDR = env.CURIO_ADDR;
const CurioABI = [
  "function totalTokenTypes () public view returns (uint256)",
  "function availableClaims () public view returns (uint256)",
  "function balanceOfBatch (address[],uint256[]) external view returns (uint256[])",
  "function uri (uint256) public view returns (string)",
  "function safeTransferFrom (address,address,uint256) public",
  "function isStillAvailable (uint256) public view returns (bool)",
  "function getClaimableSupplies () public view returns (uint8[32])",
  "function claim (uint256,uint16,bytes) public",
  "function bundle (uint256[]) public",
  "function unbundle (uint256) public",
  "function paused () public view returns (bool)",
];
let web3Modal, Provider, Signer, CURIO;

import "@google/model-viewer";

import WalletComponent from "./components/Wallet.vue";
import BundleComponent from "./components/Bundle.vue";
import StatusBarComponent from "./components/StatusBar.vue";
import HeroComponent from "./components/Hero.vue";

export default {
  components: {
    wallet: WalletComponent,
    bundle: BundleComponent,
    status: StatusBarComponent,
    hero: HeroComponent,
  },

  data() {
    return {
      showBundleModal: false,
      showUnbundleModal: false,
      isConnected: false,
      paused: false,
      walletAddress: null,
      balances: [],
      tokensOwned: [],
      selectedCards: [],
      selectedBundle: null,
      zoomedCard: null,
      meta: Meta,
      claim: {
        isAvailable: false,
        nonce: null,
        message: null,
        specials: [],
      },
      transaction: {
        processing: false,
        success: false,
        error: {
          state: false,
          message: "",
        },
      },
    };
  },

  computed: {
    hasClaim() {
      return this.claim.nonce !== null;
    },
    totalSpecialsAvailable() {
      return this.claim.specials.reduce((sum, tokenId) => (sum += tokenId), 0);
    },
    specialTokens() {
      return this.meta.filter(
        (token) =>
          typeof this.claim.specials[token.tokenId] !== "undefined" &&
          this.claim.specials[token.tokenId] > 0
      );
    },
    selectedTokenId() {
      return this.selectedCards.length === 1 ? this.selectedCards[0] : null;
    },
  },

  created() {
    try {
      web3Modal = new Web3Modal({
        network: "mainnet", // optional
        cacheProvider: true, // optional
        providerOptions: {
          walletconnect: {
            package: WalletConnectProvider,
            options: {
              infuraId: env.INFURA_ID,
            },
          },
        }, // required
      });

      console.debug(
        "web3Modal not undefined: ",
        typeof web3Modal !== "undefined"
      );
      console.debug("web3Modal.cashedProvider: ", web3Modal.cachedProvider);
      if (typeof web3Modal !== "undefined" && web3Modal.cachedProvider)
        this.connect();

      this.getPausedState();
    } catch (err) {
      console.error(err);
    }
  },

  methods: {
    async connect() {
      try {
        const instance = await web3Modal.connect();

        Provider = new ethers.providers.Web3Provider(instance);

        Provider.provider.on("accountsChanged", (accounts) => {
          this.fetchAccount();
          this.selectedCards = [];
          this.selectedBundle = null;
        });
        this.fetchAccount();
      } catch (err) {
        console.error(err);
      }
    },
    async disconnect() {
      try {
        if (Provider !== null && typeof Provider.close === "function") {
          await Provider.close();
        }

        await web3Modal.clearCachedProvider();

        this.isConnected = false;
        this.walletAddress = null;
        Provider = null;
        Signer = null;
      } catch (err) {
        console.error(err);
      }
    },
    async selectSingleCard(tokenId) {
      if (this.selectedCards.includes(tokenId)) {
        this.selectedCards = this.selectedCards.filter((id) => id !== tokenId);
      } else {
        this.selectedCards = [tokenId];
      }
    },
    async selectBundle(bundleTokenId) {
      // if targeted bundle already selected, deselect it
      if (this.selectedBundle === bundleTokenId) {
        this.selectedCards = [];
        this.selectedBundle = null;
        return;
      }
      // else, select the bundle and its dependencies
      this.selectedBundle = bundleTokenId;
      this.selectedCards = this.meta
        .filter((token) => token.tokenId === bundleTokenId)
        .map((token) => token.tokens)
        .flat();
    },
    async fetchAccount() {
      try {
        Signer = await Provider.getSigner();
        CURIO = new ethers.Contract(CURIO_ADDR, CurioABI, Signer);

        this.walletAddress = await Signer.getAddress();
        this.isConnected = true;

        this.getPausedState();
        this.getClaimData();
        this.getTokensOwned();
      } catch (e) {
        console.error('Failed to Get Address', e);
        this.isConnected = false;
        this.walletAddress = null;
      }
    },
    async getClaimData() {
      let claim;
      if (typeof Claims[this.walletAddress] !== "undefined") {
        claim = {
          isAvailable: await CURIO.isStillAvailable(
            Claims[this.walletAddress].nonce
          ),
          nonce: Claims[this.walletAddress].nonce,
          message: Claims[this.walletAddress].claim,
        };
      } else {
        claim = {
          isAvailable: false,
          nonce: null,
          message: null,
        };
      }
      claim.specials = await CURIO.getClaimableSupplies();
      claim.remaining = await CURIO.availableClaims();
      this.claim = claim;
    },
    async getTokensOwned() {
      if (this.isConnected) {
        const totalTokenTypes = (await CURIO.totalTokenTypes()).toNumber();
        const balances = (
          await CURIO.balanceOfBatch(
            Array(totalTokenTypes).fill(this.walletAddress),
            Object.keys(Array(totalTokenTypes).fill(0)).map((i) => Number(i))
          )
        ).map((balance) => balance.toNumber());

        this.balances = balances;
        this.tokensOwned = balances.reduce((owned, balance, tokenId) => {
          if (balance > 0) {
            owned.push({ tokenId, balance });
          }
          return owned;
        }, []);
      }
    },
    async getPausedState() {
      if (this.isConnected) {
        this.paused = await CURIO.paused();
        console.debug("paused: ", this.paused);
      }
    },
    async initClaim() {
      const tokenId =
        this.totalSpecialsAvailable > 0 ? this.selectedTokenId : 0;

      if (this.isConnected) {
        this.resetTransaction();
        this.transaction.processing = true;
        let tx;
        try {
          console.log(
            `claiming: ${tokenId}, ${this.claim.nonce}, ${this.claim.message}`
          );
          tx = await CURIO.claim(tokenId, this.claim.nonce, this.claim.message);
        } catch (err) {
          tx = err;
        }
        this.processingTransaction(tx, (receipt) => {
          this.getClaimData();
          this.getTokensOwned();
          this.resetSelection();
        }).catch((err) => console.error(err));
      }
    },
    initBundle() {
      this.showBundleModal = true;
    },
    async confirmBundle() {
      const bundle = this.meta.find(
        (token) => token.tokenId === this.selectedBundle
      );

      if (this.isConnected) {
        this.resetTransaction();
        this.transaction.processing = true;
        let tx;
        try {
          this.showBundleModal = false;
          tx = await CURIO.bundle(bundle.tokens);
        } catch (err) {
          tx = err;
        }
        this.processingTransaction(tx, (receipt) => {
          this.getClaimData();
          this.getTokensOwned();
          this.resetSelection();
        }).catch((err) => console.error(err));
      }
    },
    async initUnbundle() {
      this.showUnbundleModal = true;
    },
    async confirmUnbundle() {
      if (this.isConnected) {
        this.resetTransaction();
        this.transaction.processing = true;
        let tx;
        try {
          this.showUnbundleModal = false;
          tx = await CURIO.unbundle(this.selectedBundle);
        } catch (err) {
          tx = err;
        }
        this.processingTransaction(tx, (receipt) => {
          this.getClaimData();
          this.getTokensOwned();
          this.resetSelection();
        }).catch((err) => console.error(err));
      }
    },
    resetSelection() {
      this.selectedCards = [];
      this.selectedBundle = null;
    },
    resetTransaction() {
      this.transaction = {
        processing: false,
        success: false,
        error: {
          state: false,
          message: "",
        },
      };
    },
    cancel() {
      this.resetSelection();
      this.resetTransaction();
      this.showBundleModal = false;
      this.showUnbundleModal = false;
    },
    async processingTransaction(tx, cb) {
      if (typeof tx.wait === "function") {
        const receipt = await tx.wait();
        this.transaction.success = true;
        if (typeof cb === "function") cb(receipt);
      } else {
        let err = typeof tx.error !== "undefined" ? tx.error : tx;

        if (
          typeof err.data !== "undefined" &&
          typeof err.data.message !== "undefined"
        )
          this.transaction.error.message = err.data.message.replace(
            "Error: VM Exception while processing transaction: ",
            ""
          );
        else this.transaction.error.message = err.message;

        this.transaction.error.state = true;
      }

      this.transaction.processing = false;

      if (this.transaction.error.state === true)
        throw new Error(this.transaction.error.message);
    },
    validateBundleRequirements(requirements) {
      for (let i in requirements) {
        if (this.balances[requirements[i]] === 0) return false;
      }
      return true;
    },
    cardZoom(card) {
      this.zoomedCard = card;
    },
  },
};
</script>
