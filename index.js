const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId, ObjectID } = require('mongodb');
const { default: Stripe } = require('stripe');

const port = process.env.PORT || 5000
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
app.use(cors());

app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gs7iegj.mongodb.net/?retryWrites=true&w=majority` ;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

async function run(){
    try{
        await client.connect();
        const serviceCollection = client.db('e_motor_bike').collection('services');
        const userCollection = client.db('e_motor_bike').collection('users');
        const bookingCollection = client.db('e_motor_bike').collection('bookings');
        const bikeCollection = client.db('e_motor_bike').collection('bikes');
        const bikeBookingCollection = client.db('e_motor_bike').collection('bikeBooked');
        const paymentCollection = client.db('doctors_portal').collection('payments');




        app.post('/create-payment-intent', verifyJWT, async(req, res) =>{
            const service = req.body;
            const price = service.price;
            const amount = price*10;
            const paymentIntent = await stripe.paymentIntents.create({
                amount : amount,
                currency: 'usd',
                payment_method_types:['card']
            });
            res.send({clientSecret: paymentIntent.client_secret})
        });






        app.get('/service', async(req,res) =>{
            const query = {}
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });

        app.get('/user',verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
            // console.log(users);
        });
        app.get('/bike', async (req, res) => {
            const bikes = await bikeCollection.find().toArray();
            res.send(bikes);
            // console.log(bikes);
        });

        app.get('/admin/:email', async(req, res) =>{
            const email = req.params.email;
            const user = await userCollection.findOne({email: email});
            const isAdmin = user.role === 'admin';
            res.send({admin: isAdmin})
        });

        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            }
            else{
                res.status(403).send({message: 'forbidden'});
            }
    
        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({email:email},process.env.ACCESS_TOKEN_SECRET,{ expiresIn: '1h' })
            res.send({result, token});
            // console.log(result,token);
        });

        app.get('/available', async(req, res) => {
            const date= req.query.date;

            // get all services
            const services = await serviceCollection.find().toArray();

            // get the booking of that day
            const query ={date:date};
            const bookings = await bookingCollection.find(query).toArray();

            // for each to find bookings of that service
            services.forEach(service =>{
                const serviceBookings = bookings.filter(book => book.booking === service.name);
            // step 5: select slots for the service Bookings: ['', '', '', '']
                const bookedSlots = serviceBookings.map(book => book.slot);
            // step 6: select those slots that are not in bookedSlots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
            //step 7: set available to slots to make it easier 
                service.slots = available;
                // service.booked=serviceBookings.map(b => b.slot);  
            })

            res.send(services);
            // console.log(services);
        });
    

        

        app.get('/booking', verifyJWT, async(req, res) =>{
            const customer = req.query.customer;
            const decodedEmail = req.decoded.email;
            if (customer === decodedEmail) {
                const query = { customer: customer};
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }
            
        });

        app.get('/booking/:id', async(req, res) =>{
            const id = req.params.id;
            const query = {_id: ObjectId(id)};
            const result = await bookingCollection.findOne(query);
            res.send(result);
            // console.log(query);
        })


        app.get('/bikeBooking', async (req, res) => {
            const userEmail = req.query.userEmail;
            const query = {userEmail: userEmail}
            const bikeBooking = await bikeBookingCollection.find(query).toArray();
            // console.log(bikeBooking);
            res.send(bikeBooking);
        })

        app.get('/bikeBooking/:id', async(req,res)=>{
            const id =req.params.id;
            const query = {_id:ObjectId(id)};
            const result = await bikeBookingCollection.findOne(query);
            res.send(result);
            // console.log(result);
        })


        



        app.post('/booking',async(req,res) =>{
            const postBooking =req.body;
            const query = {booking: postBooking.booking, date:postBooking.date, customer:postBooking.customer}
            const exists = await bookingCollection.findOne(query)
            if(exists){
                return res.send({success: false, postBooking: exists})
            }
            const result = bookingCollection.insertOne(postBooking);
            return res.send({success: true, result});
        })
        
        app.post('/bikeBooking', async (req,res) =>{
            const bikeBooking =req.body;
            // const query = {treatment: bikeBooking.treatment,userEmail:bikeBooking.userEmail}
            const result = await bikeBookingCollection.insertOne(bikeBooking);
            // console.log(result)
            res.send(result);
        });
        app.delete('/bikeBooking/:email', async (req,res) =>{
            const userEmail =req.params.userEmail;
            const filter = {Usermail: userEmail}
            const result = await bikeCollection.deleteOne(filter);
            // console.log(result)
            res.send(result);
        });



        app.patch('/booking/:id', verifyJWT, async(req, res) =>{
            const id  = req.params.id;
            const payment = req.body;
            const filter = {_id: ObjectId(id)};
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedBooking);
        })
        app.patch('/bikeBooking/:id', verifyJWT, async(req, res) =>{
            const id  = req.params.id;
            const payment = req.body;
            const filter = {_id: ObjectId(id)};
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bikeBookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedBooking);
        })


        
    }
    finally{

    }

}
run().catch(console.dir)



app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})