main.floors.F3=
{
    "floorId": "F3",
    "title": "傀儡庭院",
    "name": "傀儡庭院",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 976,
    "bgm": "2.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,1": [
            {
                "type": "setValue",
                "name": "flag:f",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:f==2)",
                "true": [
                    {
                        "type": "if",
                        "condition": "(item:I582==1)",
                        "true": [
                            {
                                "type": "win",
                                "reason": "傀儡庭院 Easy"
                            }
                        ],
                        "false": []
                    },
                    {
                        "type": "win",
                        "reason": "傀儡庭院 Chaos"
                    }
                ],
                "false": []
            }
        ],
        "11,1": [
            {
                "type": "setValue",
                "name": "flag:f",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "if",
                "condition": "(flag:f==2)",
                "true": [
                    {
                        "type": "if",
                        "condition": "(item:I582==1)",
                        "true": [
                            {
                                "type": "win",
                                "reason": "傀儡庭院 Easy"
                            }
                        ],
                        "false": []
                    },
                    {
                        "type": "win",
                        "reason": "傀儡庭院 Chaos"
                    }
                ],
                "false": []
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [40654,40655,40654,40646,40647,40646,40647,40646,40647,40647,40654,40655,40654],
    [918,250,918,40654,40655,40654,40655,40654,40655,40654,  0,250,918],
    [918, 30,  0,217,  0,918, 32,  0, 21,220, 30,  0,918],
    [918,918,918,918,236,918, 82,918,918,918, 81,918,918],
    [ 22,  0,220, 82, 31,918,209,918,  0, 29,236, 21,918],
    [  0,237,  0,918,  0,918,  0,217, 27,  0,918,  0,918],
    [ 27,  0, 28,918, 32,214, 31,918,  0, 32,225, 34,918],
    [918, 81,918,918, 82,918,918,918,918,918, 81,918,918],
    [918, 28,  0,918, 21,918, 28,918,918, 28,236, 27,918],
    [918,918,209, 81,220,  0,209,918,236,  0,918, 81,918],
    [918,  0,577,918,  0,237,  0, 81,  0, 27,918,  0,918],
    [918, 88,  0, 82, 21,  0, 21,918,236,  0,225, 29,918],
    [918,918,918,918,918,918,918,918,918,918,918,918,918]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}