# WikiDuel

Course Wikipédia en versus sur mobile. Tous les joueurs partent du même article et doivent atteindre le même article cible en cliquant uniquement sur les liens des pages. Le premier arrivé gagne.

**En ligne : https://wikiduel.ch** (adresse de secours : https://wikiduel.web.app)

- **Page web statique** : `index.html`, hébergée sur Firebase Hosting avec le domaine `wikiduel.ch`, enregistré chez Infomaniak.
- **Salons en temps réel** : Firebase Realtime Database avec connexion anonyme.
- **Articles** : chargés directement depuis fr.wikipedia.org par le téléphone de chaque joueur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Le jeu complet (interface, lecteur Wikipédia, salons) |
| `firebase-config.js` | La configuration de ton projet Firebase (à remplir) |
| `database.rules.json` | Les règles de sécurité à copier dans Firebase |
| `dev-server.js` | Serveur local pour tester avant de publier (`node dev-server.js`) |

## 1. Créer le projet Firebase (gratuit)

1. Va sur https://console.firebase.google.com et clique sur **Créer un projet**. Google Analytics n'est pas nécessaire.
2. **Authentication** > **Commencer** > onglet **Mode de connexion** : active **Anonyme**.
3. **Realtime Database** > **Créer une base de données** : choisis l'emplacement **Belgique (europe-west1)**, puis **Démarrer en mode verrouillé**.
4. Dans Realtime Database, onglet **Règles** : remplace tout le contenu par celui de `database.rules.json`, puis clique sur **Publier**.
5. **Paramètres du projet** (roue dentée) > **Général** > **Vos applications** : clique sur l'icône Web `</>` et donne-lui le nom « WikiDuel ».
6. Firebase affiche un objet `firebaseConfig`. Copie ses valeurs dans `firebase-config.js` : `apiKey`, `authDomain`, `databaseURL`, `projectId` et `appId`.
   - Si `databaseURL` n'apparaît pas, copie l'URL affichée en haut de la page Realtime Database.

Ces valeurs ne sont pas des secrets : elles finissent dans la page publique de toute façon. La protection vient des règles de l'étape 4.

## 2. Publier le site (Firebase Hosting)

Le code est stocké sur GitHub (https://github.com/YORICKK/WikiDuel), mais la page est servie par **Firebase Hosting**. Contrairement à GitHub Pages, l'usage commercial y est autorisé.

1. Publie la page :
   ```bash
   firebase deploy --only hosting
   ```
   Seuls `index.html` et `firebase-config.js` sont publiés (voir `ignore` dans `firebase.json`).
2. Pour le domaine personnalisé : Firebase > **Hosting** > **Ajouter un domaine personnalisé**, puis saisis les enregistrements affichés dans la zone DNS du registrar. Pour `wikiduel.ch`, chez Infomaniak :
   - **A** (racine) : `199.36.158.100`
   - **TXT** (racine) : `hosting-site=wikiduel`
3. Dans Firebase, **Authentication** > **Paramètres** > **Domaines autorisés** : ajoute le domaine.

Sur Windows, si PowerShell refuse `firebase` (scripts désactivés), utilise `firebase.cmd` à la place.

## 3. Parties classées (Google + Elo)

Le mode classé demande le forfait **Blaze**, car une Cloud Function vérifie les chemins et calcule l'Elo côté serveur.

- `functions/index.js` se déclenche à la fin de chaque manche classée.
  - Il vérifie auprès de Wikipédia que chaque étape du chemin est un vrai lien.
  - Il calcule l'Elo : départ à 1200, K = 40 pendant les 10 premières parties, puis 20.
  - Il écrit le résultat dans `users/` et `results/`, deux zones que les joueurs ne peuvent pas modifier.
- Le classement (top 50) est lu dans `users/`, trié par Elo.

### Mise en place

1. Dans Firebase, **Authentication** > **Mode de connexion** > **Ajouter un fournisseur** : active **Google**, puis choisis l'adresse e-mail d'assistance.
2. Installe **Node.js 22 LTS** depuis https://nodejs.org. Le déploiement ne fonctionne pas avec Node 8.
3. Installe l'outil Firebase et connecte-toi :
   ```bash
   npm install -g firebase-tools
   ```
   ```bash
   firebase login
   ```
4. Installe les dépendances de la fonction :
   ```bash
   cd functions && npm install && cd ..
   ```
5. Déploie les règles et la fonction :
   ```bash
   firebase deploy --only database,functions
   ```
   Ensuite, `firebase deploy --only database` suffit pour ne republier que les règles.
6. Conseillé : dans Google Cloud > **Facturation** > **Budgets et alertes**, crée une alerte à 1 €.

## 4. WikiDuel+ (paiement) et pages légales

- **Prix** : 2 CHF, paiement unique (constante `PREMIUM_PRICE` dans `functions/index.js`).
- **Paiement** : Stripe Checkout. `createCheckout` crée la page de paiement, puis `stripeWebhook` active `users/<uid>/premium` (et le retire en cas de remboursement).
- **Secrets** (jamais dans le code), à enregistrer puis redéployer les fonctions :
  ```bash
  firebase.cmd functions:secrets:set STRIPE_SECRET_KEY --project wikiduel
  ```
  ```bash
  firebase.cmd functions:secrets:set STRIPE_WEBHOOK_SECRET --project wikiduel
  ```
  En mode réel, une clé restreinte `rk_live_` suffit : Checkout Sessions en écriture, PaymentIntents en lecture.
- **Webhook Stripe** : `https://europe-west1-wikiduel.cloudfunctions.net/stripeWebhook`. Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded` et `charge.refunded`.
- **Pages légales** : `cgv.html` (conditions de vente) et `confidentialite.html` (confidentialité), publiées sur `/cgv` et `/confidentialite`.
- **Nettoyage** : la fonction `cleanup` tourne chaque jour à 4 h. Elle supprime les salons, résultats et chemins de plus de 30 jours, ainsi que la file d'attente et les appariements de plus d'un jour, comme annoncé dans la politique de confidentialité.

## Tester en local

```bash
node dev-server.js
```
Ouvre ensuite http://localhost:3000. `localhost` est autorisé par défaut dans Firebase.

## Limites connues

- Les vieux salons ne sont jamais supprimés. Ils pèsent quelques Ko chacun : supprime le nœud `rooms` dans la console de temps en temps.
- Si l'hôte quitte une course en cours, personne ne peut relancer de manche dans ce salon. Il faut en créer un nouveau.
- En partie entre amis, le téléphone de chaque joueur annonce lui-même son arrivée : un joueur déterminé pourrait tricher. En partie classée, le serveur vérifie le chemin.
- En partie classée, la vérification accepte aussi les liens des boîtes de navigation que l'affichage du jeu masque.
- Un hôte qui supprime son adversaire du salon en pleine course empêche la manche d'être classée, mais n'y gagne aucun point.
