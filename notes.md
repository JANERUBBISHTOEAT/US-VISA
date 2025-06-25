# US-VISA

## URLS

- <https://ais.usvisa-info.com/en-ca/niv/schedule/xxx/appointment>

## API DOC

`base = https://ais.usvisa-info.com/en-ca/niv/schedule/xxx/appointment/`

### Get location

GET `base + address/95`
> Get the address of the appointment.
> 95 - Vancouver
> 94 - Toronto
RESPONSE:

```html
1075 West Pender Street
<br>
Vancouver, BC, V6E 2M6
<br>
Canada

225 Simcoe Street
<br>
Toronto, ON, Ontario, M5G 1S4
<br>
Canada

```

Elements:

```html
<li class="select input required" id="appointments_consulate_appointment_facility_id_input"><select name="appointments[consulate_appointment][facility_id]" id="appointments_consulate_appointment_facility_id" class="required"><option value="" label=" "></option>
<option data-collects-biometrics="false" value="89">Calgary</option>
<option data-collects-biometrics="false" value="90">Halifax</option>
<option data-collects-biometrics="false" value="91">Montreal</option>
<option data-collects-biometrics="false" value="92">Ottawa</option>
<option data-collects-biometrics="false" value="93">Quebec City</option>
<option data-collects-biometrics="false" value="94">Toronto</option>
<option data-collects-biometrics="false" selected="selected" value="95">Vancouver</option></select>
</li>
```

### Get available dates given a location

GET `base + days/95.json?appointments[expedite]=false`
RESPONSE:

```json
[{"date":"2027-03-02","business_day":true},
{"date":"2027-03-04","business_day":true},
...
{"date":"2027-10-28","business_day":true},
{"date":"2027-10-29","business_day":true}]
```

### Get available times given a date

GET `base + times/94.json?date=2027-03-10&appointments[expedite]=false`
RESPONSE:

```json
{"available_times":[
    "07:15","07:30","07:45","08:00","08:15","08:30","08:45","09:00","09:15","09:30","09:45","10:00","10:15","10:30","10:45","11:00","11:15","11:30","11:45"
],"business_times":[
    "07:15","07:30","07:45","08:00","08:15","08:30","08:45","09:00","09:15","09:30","09:45","10:00","10:15","10:30","10:45","11:00","11:15","11:30","11:45"
]}
```
