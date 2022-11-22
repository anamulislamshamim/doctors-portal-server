require("dotenv").config();
const express = require("express");
const PORT = process.env.PORT || 5000;
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SK);
const jwt = require("jsonwebtoken");
// create app
const app = express();
// set up the cors 
app.use(cors());
// set the middleware to read the form and json data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// mongo db start

const uri = `mongodb+srv://shamim:${process.env.MONGODB_PASSWORD}@cluster0.od9o8tu.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
// client.connect(err => {
//   const collection = client.db("test").collection("devices");
//   // perform actions on the collection object
//   client.close();
// });
// verifyJWT middleware
function verifyJWT(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if(!token){ 
        return res.status(401).send({message:"unauthorized!"});
    };
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET_KEY, (err, decoded) => {
        if(err){
            return res.status(403).send({message:"forbidden"});
        };
        req.decoded = decoded;
        next();
    });
};
async function run() {
    client.connect((err) => {
        if (err) {
            console.log("MongoDb connection failed!");
        } else {
            console.log("MongoDb connected successfully");
        };
    });
    try {
        const db = client.db("doctors-portal");
        const appoinmentOptions = db.collection("AvailableOptions");
        const bookingsColl = db.collection("bookings");
        const userColl = db.collection("users");
        const doctorsColl = db.collection("doctors");
        const transactionInfo = db.collection("transactions");
        // create middle ware inside the function
        const verifyAdmin = async(req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = {email:decodedEmail};
            const user = await userColl.findOne(query);
            if(user?.role !== 'admin'){
                res.status(403).send("forbidden");
            };
            next();
        }
        // store the trasaction data:
        app.post("/transaction-info", verifyJWT, async(req, res) => {
            const info = req.body;
            console.log(info);
            const result = await transactionInfo.insertOne(info);
            res.send(result);
        })
        // get all the options:
        app.get("/appoinmentOptions", async (req, res) => {
            // console.log(req.query.date);
            const query = {};
            const options = await appoinmentOptions.find(query).toArray();
            const bookingQuery = { appoinmentDate: req.query.date };
            const alreadyBooked = await bookingsColl.find(bookingQuery).toArray();
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                // console.log(optionBooked);
                const bookedSlots = optionBooked.map(book => book.slot);
                // console.log(option.name,bookedSlots);
                const remaining = option.slots.filter(slot => !bookedSlots.includes(slot));
                option.slots=remaining;
            });
            res.send(options);
        });
        // get only the appoinments speciality:
        app.get("/appoinmentSpeciality", async(req, res) => {
            const query = {};
            const result = await appoinmentOptions.find(query).project({name:1}).toArray();
            res.send(result);
        })
        // bookings
        // get bookings:
        app.get("/bookings", verifyJWT , async(req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if(email !== decodedEmail){
                res.status(403).send({ message: "Forbidden!" });
            };
            const query = { email: email };
            const bookings = await bookingsColl.find(query).toArray();
            res.send(bookings);
        });
        // get a single book by id
        app.get("/bookings/:id", async(req, res) => {
            const query = { _id:ObjectId(req.params.id) };
            const result = await bookingsColl.findOne(query);
            res.send(result);
        })
        // create bookings
        app.post("/bookings", async (req, res) => {
            const booking = req.body;
            const query = {
                treatment:booking.treatment,
                appoinmentDate:booking.appoinmentDate,
                email:booking.email
            };
            const isBooked = await bookingsColl.find(query).toArray();
            if(isBooked.length){
                return res.send({acknowledged:false, message:`You have a booking on ${ booking.appoinmentDate }`})
            };
            const result = await bookingsColl.insertOne(booking);
            res.send(result);
            // console.log(result);
        });
        // added new doctor:
        app.post("/addDoctor",verifyJWT,verifyAdmin, async(req, res) => {
            const doctor = req.body;
            const result = await doctorsColl.insertOne(doctor);
            res.send(result);
        });
        // get the doctors
        app.get("/doctors",verifyJWT, verifyAdmin, async(req, res) => {
            const query = {};
            const doctors = await doctorsColl.find(query).toArray();
            res.send(doctors);
        });
        // delete doctor
        app.delete("/dashboard/manage-doctors/delete/:id",verifyJWT,verifyAdmin, async(req, res) => {
            const query = { _id:ObjectId(req.params.id) };
            const deleteResult = await doctorsColl.deleteOne(query);
            res.send(deleteResult);
        });
        // stripe pament gateway:
        app.post("/create-payment-intent", async(req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price*100;

            // create the payment with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount:amount,
                currency:'usd',
                "payment_method_types":["card"]
            });
            res.send({
                clientSecrent: paymentIntent.client_secret,
            });
        });
        // send jwt token for the valid user
        app.get("/jwt", async(req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await userColl.findOne(query);
            if(user){
                const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET_KEY, {expiresIn:"1h"});
                res.send({access_token:token});
            }else{
                res.status(403).send({ status:403, error:"invalid user!"});
            };

        });
        // store user info when register
        app.post("/users", async(req, res) => {
            const user = req.body;
            const result = await userColl.insertOne(user);
            res.send(result);
        });
        // get all users for the dashboard:
        app.get("/dashboard/all-users", async(req, res) => {
            const query = {};
            const users = await userColl.find(query).toArray();
            res.send(users);
        });
        // user role updated
        app.put("/dashboard/users/admin/:id",verifyJWT,verifyAdmin, async(req, res) => {
            const id=req.params.id;
            const options = { upsert: true };
            const updateDoc = {
                $set:{
                    role:'admin'
                }
            };
            const updated = await userColl.updateOne({_id:ObjectId(id)},updateDoc,options);
            res.send(updated);
        });
        // check is the use has admin role:
        app.get("/user/admin/:email", async(req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await userColl.findOne(query);
            res.send({ isAdmin: user?.role === 'admin'});
        })
    } finally {
        // client.close(); 
    };
};
run().catch(err => console.log(err));
// mongodb end
// home route 
app.get("/", (req, res) => {
    res.status(200).send({ status: 200, message: "Welcome to the server!" });
});

// connect the app to the port
app.listen(PORT, () => {
    console.log(`The server is running at http://127.0.0.1:${PORT}`);
});