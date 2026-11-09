# WikiDuel

Course Wikipédia en versus sur mobile. Tous les joueurs partent du même article et doivent atteindre le même article cible en cliquant uniquement sur les liens des pages. Le premier arrivé gagne.

- **Page web statique** : `index.html`, hébergée sur GitHub Pages.
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
5. **Paramètres du projet** (roue dentée) > **Général** > **Vos applications** : clique sur l'icône Web `</>` et donne-lui le nom « WikiDuel ». N'active pas Firebase Hosting.
6. Firebase affiche un objet `firebaseConfig`. Copie ses valeurs dans `firebase-config.js` : `apiKey`, `authDomain`, `databaseURL`, `projectId` et `appId`.
   - Si `databaseURL` n'apparaît pas, copie l'URL affichée en haut de la page Realtime Database.

Ces valeurs ne sont pas des secrets : elles finissent dans la page publique de toute façon. La protection vient des règles de l'étape 4.

## 2. Publier sur GitHub Pages

1. Crée un dépôt sur https://github.com/new, par exemple `wikiduel`, en **Public**. GitHub Pages gratuit exige un dépôt public.
2. Envoie les fichiers :
   ```bash
   git remote add origin https://github.com/TON-PSEUDO/wikiduel.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings** > **Pages** > Source : **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
4. Après une à deux minutes, le jeu est en ligne à l'adresse `https://TON-PSEUDO.github.io/wikiduel/`.
5. Dans Firebase, **Authentication** > **Paramètres** > **Domaines autorisés** : ajoute `TON-PSEUDO.github.io`.

## Tester en local

```bash
node dev-server.js
```
Ouvre ensuite http://localhost:3000. `localhost` est autorisé par défaut dans Firebase.

## Limites connues

- Les vieux salons ne sont jamais supprimés. Ils pèsent quelques Ko chacun : supprime le nœud `rooms` dans la console de temps en temps.
- Si l'hôte quitte une course en cours, personne ne peut relancer de manche dans ce salon. Il faut en créer un nouveau.
- Le téléphone de chaque joueur annonce lui-même son arrivée : un joueur déterminé pourrait tricher.
