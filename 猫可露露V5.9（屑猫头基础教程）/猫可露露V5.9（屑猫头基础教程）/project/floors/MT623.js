main.floors.MT623=
{
    "floorId": "MT623",
    "title": "623 层",
    "name": "623 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "10.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 50000000000,
    "defaultGround": 906,
    "bgm": "33.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "10,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT623_1_4",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "1,4": {
            "0": {
                "condition": "flag:door_MT623_1_4==1",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT623_1_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "1,3": {
            "0": {
                "condition": "flag:door_MT623_1_4==1",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT623_1_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "1,2": {
            "0": {
                "condition": "flag:door_MT623_1_4==1",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT623_1_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  4,  4,  4,  4,  4,908,908,908,908,908,908,908,908],
    [ 21, 87,  4,  4,1622,642,908,  0,1007, 82,1622,  0,908],
    [  4, 85,  4,1622,908,  0,645,1618,  0,908,  0,644,908],
    [  4, 85,  4,908,908, 81,908, 82,908,908,908,1620,908],
    [  4, 85,  4,908,  0,1010, 82,1582,  0,908,  0,643,908],
    [908,  0,1015, 82,639,  0,908,645,1621, 82, 21,  0,908],
    [908,1619,908,908,1618,908,908,908,907,907,907,907,907],
    [908, 21,  0,908,1011,908,  0, 21,907,  0,1590,  0,907],
    [908,  0,639,1622,  0,1617,1010,  0, 83,1437,  0,1437,907],
    [908,908, 15,908, 81,908,908, 82,907,  0,1012,  0,907],
    [908,  0,1015,1621,640,  0, 15,1011,907,646,  0,733,907],
    [908, 88,  0,908,  0,1620,638,  0,1619,  0,732,  0, 83],
    [908,908,908,908,908,908,908,908,907,907,907,907,1011]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,153,153,153]
],
    "bg2map": [

],
    "fg2map": [

]
}