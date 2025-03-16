import * as CardGame from "./CardGame.mjs";

export class GameState {
  constructor(players) {
    this.players = players;
    this.currentPlayerIndex = 0;
    this.lastPlayedHand = []; // The last played hand on the table
    this.scores = {}; // Keeps track of wins
    this.playerHands = {};
    this.moveHistory = []; // An array of {name, handPlayed}
    this.round = 1;
    this.lastValidPlayIndex = null; // Track who made the last valid play
    this.passedPlayers = [];
    this.deck = this.createDeck();
    this.lowestCardValue = null;

    this.initializeGame();
  }

  initializeGame() {
    // Initialize scores
    this.players.forEach(player => {
      this.scores[player.name] = 0;
    });

    // Distribute cards based on player count
    if (this.players.length === 4) {
      // 4 players: deal 13 cards to each player
      this.players.forEach(player => {
        this.playerHands[player.name] = this.deck.splice(0, 13);
      });
    } else if (this.players.length === 3) {
      // 3 players: divide 52 cards as evenly as possible (17-17-18)
      for (let i = 0; i < this.players.length; i++) {
        // Give 17 cards to each player initially
        this.playerHands[this.players[i].name] = this.deck.splice(0, 17);
      }
      // There's 1 card left over, we'll give it to the player with the lowest card
    } else if (this.players.length === 2) {
      // 2 players: give each player 1/3 of the deck (17 cards each)
      for (let i = 0; i < this.players.length; i++) {
        this.playerHands[this.players[i].name] = this.deck.splice(0, 17);
      }
      // We have 18 cards left over, but we'll only use 1 of them
      // Discard the rest
      this.deck.splice(0, 17);
      // There's 1 card left over, we'll give it to the player with the lowest card
    }

    // Find player with the lowest card (3 of clubs with value 3.1)
    let lowestCardPlayerIndex = 0;
    let lowestCardValue = Infinity;
    let foundLowestClub = false;

    // First search for the 3 of clubs (value 3.1) specifically
    for (let i = 0; i < this.players.length; i++) {
      const playerName = this.players[i].name;
      const hand = this.playerHands[playerName];

      for (const card of hand) {
        const cardValue = CardGame.getCardValue(card);
        if (cardValue === 3.1) {
          lowestCardPlayerIndex = i;
          lowestCardValue = cardValue
          foundLowestClub = true;
          break;
        }
      }

      if (foundLowestClub) break;
    }

    // If 3 of clubs wasn't found (possible in 2-player mode), find the lowest card
    if (!foundLowestClub && this.players.length === 2) {
      for (let i = 0; i < this.players.length; i++) {
        const playerName = this.players[i].name;
        const hand = this.playerHands[playerName];

        for (const card of hand) {
          const cardValue = CardGame.getCardValue(card);
          if (cardValue < lowestCardValue) {
            lowestCardValue = cardValue;
            lowestCardPlayerIndex = i;
          }
        }
      }
    }


    // If there's a leftover card (in 2 or 3 player mode), give it to the player with the lowest card
    if (this.players.length < 4 && this.deck.length > 0) {
      const extraCard = this.deck.pop();
      const playerWithLowestCard = this.players[lowestCardPlayerIndex].name;
      this.playerHands[playerWithLowestCard].push(extraCard);
    }

    console.log("Lowest card value:", lowestCardValue);

    this.lowestCardValue = lowestCardValue;

    // Set the starting player to the one with the lowest card
    this.currentPlayerIndex = lowestCardPlayerIndex;
    console.log(`Game starts with player: ${this.players[lowestCardPlayerIndex].name}`);
  }

  playCards(playerName, cards) {
    // Find the player in the game
    const player = this.players.find(p => p.name === playerName);
    if (!player) return { success: false, message: "Player not found" };

    // Get the player's hand
    const hand = this.playerHands[playerName];
    if (!hand) return { success: false, message: "Player hand not found" };

    // Validate that all cards exist in the player's hand
    const allCardsInHand = cards.every(card =>
      hand.some(handCard =>
        handCard.suit === card.suit && handCard.value === card.value
      )
    );

    if (!allCardsInHand) {
      return { success: false, message: "One or more cards not in player's hand" };
    }

    // Validate the play according to game rules
    const validationResult = CardGame.validatePlay(this.moveHistory, this.lastPlayedHand, cards, this.lowestCardValue);
    if (!validationResult.valid) {
      return { success: false, message: validationResult.message };
    }

    // Reset passed players since this is a new round if everyone else passed
    if (this.passedPlayers.length === this.players.length - 1) {
      this.passedPlayers = [];
    }

    console.log(`${playerName} played cards, setting lastValidPlayIndex to ${this.currentPlayerIndex}`);
    this.lastValidPlayIndex = this.currentPlayerIndex;

    // Remove the played cards from hand
    for (const card of cards) {
      const cardIndex = hand.findIndex(handCard =>
        handCard.suit === card.suit && handCard.value === card.value
      );

      if (cardIndex !== -1) {
        hand.splice(cardIndex, 1);
      }
    }

    // Set played cards
    this.lastPlayedHand = [...cards];
    
    // Update history
    this.moveHistory.push({name: playerName, handPlayed: cards})

    // Check if player has emptied their hand (win condition)
    if (hand.length === 0) {
      this.status = "finished";
      this.winner = playerName;
      // Update scores
      this.scores[playerName] = (this.scores[playerName] || 0) + 1;
    }

    // Move to next player
    this.nextTurn();

    // Return success
    return {
      success: true,
      gameStatus: this.status,
      winner: this.status === "finished" ? this.winner : null
    };
  }

  passTurn(playerName) {
    console.log(`${playerName} is attempting to pass`);
    console.log(`Current passed players: ${this.passedPlayers.map(p => p)}`);

    const player = this.players.find(p => p.name === playerName);
    if (!player) return { success: false, message: "Player not found" };

    // Check if it's the player's turn
    if (this.getCurrentPlayer().name !== playerName) {
      return { success: false, message: "Not your turn" };
    }

    // Check if the player can pass
    if (this.lastPlayedHand.length === 0) {
      return { success: false, message: "Cannot pass on first play" };
    }

    // Add player to passed players list if not already there
    if (!this.passedPlayers.includes(playerName)) {
      this.passedPlayers.push(playerName);
      console.log(`Added ${playerName} to passed players`);
      console.log(`Passed players: ${this.passedPlayers.length}/${this.players.length}`);
    }

    // Check if everyone except one player has passed
    if (this.passedPlayers.length >= this.players.length - 1) {
      console.log("All players except one have passed, starting new round");
      // Everyone else has passed, new round starts with the last player who made a valid play
      this.currentPlayerIndex = this.lastValidPlayIndex;
      this.lastPlayedHand = []; // Clear played cards for new round
      this.passedPlayers = []; // Reset passed players for new round
      this.round += 1;

      return {
        success: true,
        action: 'pass',
        newRound: true
      };
    } else {
      // Move to next player
      console.log(`Moving to next player after ${playerName} passed`);
      this.nextTurn();
      console.log(`Next player is ${this.getCurrentPlayer().name}`);

      return {
        success: true,
        action: 'pass'
      };
    }
  }

  handleAITurn(aiPlayer) {
    console.log("AI Turn", aiPlayer);
    console.log("Passed players count", this.passedPlayers.length);
    const hand = this.playerHands[aiPlayer.name];
    const moveResult = CardGame.calculateAIMove(hand, this.lastPlayedHand);

    if (moveResult.action === 'play') {
      return this.playCards(aiPlayer.name, moveResult.cards);
    } else {
      return this.passTurn(aiPlayer.name);
    }
  }

  nextTurn() {
    console.log(`Finding next player after ${this.players[this.currentPlayerIndex].name}`);
    console.log(`Current passed players: ${this.passedPlayers.map(p => p)}`);

    // Find the next player who hasn't passed
    let skipped = 0;

    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      const nextPlayer = this.players[this.currentPlayerIndex].name;
      const isPassed = this.passedPlayers.includes(nextPlayer);

      console.log(`Checking player ${nextPlayer}: ${isPassed ? 'has passed' : 'has not passed'}`);

      skipped++;
      // Prevent infinite loop
      if (skipped > this.players.length) {
        console.warn("Infinite loop detected, resetting passedPlayers");
        this.passedPlayers = [];
        break;
      }
    } while (this.passedPlayers.includes(this.players[this.currentPlayerIndex].name));

    console.log(`Next turn goes to ${this.players[this.currentPlayerIndex].name}`);
    return this.getCurrentPlayer();
  }

  createDeck() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck = [];

    for (const suit of suits) {
      for (const value of values) {
        deck.push({ suit, value });
      }
    }

    // Shuffle deck
    return this.shuffleDeck(deck);
  }

  // Fisher-Yates shuffle
  shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }
}